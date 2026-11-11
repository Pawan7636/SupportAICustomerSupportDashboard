import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { getDb } from "../db/database";
import { signAccessToken, signRefreshToken, verifyRefreshToken, hashToken } from "../utils/jwt";
import { validate } from "../middleware/validate";
import { authenticate } from "../middleware/authenticate";
import { ok, created, unauthorized, conflict, notFound } from "../utils/response";
import type { UserRow, RefreshTokenRow } from "../types";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Auth router
//  POST /auth/register  — create account (customer self-registration)
//  POST /auth/login     — issue tokens
//  POST /auth/refresh   — rotate refresh token
//  POST /auth/logout    — revoke refresh token
//  GET  /auth/me        — current user info
// ─────────────────────────────────────────────────────────────────────────────

export const authRouter = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a digit")
    .regex(/[^A-Za-z0-9]/, "Must contain a special character"),
  full_name: z.string().min(1).max(120).trim(),
});

const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeUser(user: UserRow) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash: _ph, ...safe } = user;
  return { ...safe, is_active: Boolean(safe.is_active) };
}

async function issueTokenPair(user: UserRow) {
  const db = getDb();

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ sub: user.id, email: user.email, role: user.role }),
    signRefreshToken({ sub: user.id, email: user.email, role: user.role }),
  ]);

  const expiresAt = new Date(
    Date.now() + parseDuration(process.env["JWT_REFRESH_EXPIRES_IN"] ?? "7d")
  ).toISOString();

  // Store a hashed version of the refresh token (never the raw value)
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (@id, @user_id, @token_hash, @expires_at)
  `).run({
    id: uuid(),
    user_id: user.id,
    token_hash: hashToken(refreshToken),
    expires_at: expiresAt,
  });

  return { access_token: accessToken, refresh_token: refreshToken };
}

/** Parse simple duration strings like "7d", "15m", "1h" → milliseconds */
function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return n * 1000;
    case "m": return n * 60 * 1000;
    case "h": return n * 60 * 60 * 1000;
    case "d": return n * 24 * 60 * 60 * 1000;
    default:  return n * 1000;
  }
}

// ── POST /auth/register ───────────────────────────────────────────────────────

authRouter.post(
  "/register",
  validate({ body: RegisterSchema }),
  async (req, res, next) => {
    try {
      const { email, password, full_name } = req.body as z.infer<typeof RegisterSchema>;
      const db = getDb();

      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) {
        conflict(res, "An account with this email already exists");
        return;
      }

      const rounds = parseInt(process.env["BCRYPT_ROUNDS"] ?? "12", 10);
      const password_hash = await bcrypt.hash(password, rounds);
      const id = uuid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
        VALUES (@id, @email, @password_hash, @full_name, 'customer', 1, @now, @now)
      `).run({ id, email, password_hash, full_name, now });

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
      const tokens = await issueTokenPair(user);

      logger.info("User registered", { userId: id, role: "customer" });

      created(res, { user: sanitizeUser(user), ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /auth/login ──────────────────────────────────────────────────────────

authRouter.post(
  "/login",
  validate({ body: LoginSchema }),
  async (req, res, next) => {
    try {
      const { email, password } = req.body as z.infer<typeof LoginSchema>;
      const db = getDb();

      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;

      // Always run bcrypt to prevent timing attacks (even if user not found)
      const dummyHash = "$2b$12$invalidhashpaddingtomatchcostfactor";
      const match = await bcrypt.compare(password, user?.password_hash ?? dummyHash);

      if (!user || !match || !user.is_active) {
        unauthorized(res, "Invalid email or password");
        return;
      }

      const tokens = await issueTokenPair(user);

      logger.info("User logged in", { userId: user.id, role: user.role });

      ok(res, { user: sanitizeUser(user), ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /auth/refresh ────────────────────────────────────────────────────────

authRouter.post(
  "/refresh",
  validate({ body: RefreshSchema }),
  async (req, res, next) => {
    try {
      const { refresh_token } = req.body as z.infer<typeof RefreshSchema>;
      const db = getDb();

      // Verify JWT signature first
      let payload;
      try {
        payload = await verifyRefreshToken(refresh_token);
      } catch {
        unauthorized(res, "Invalid or expired refresh token");
        return;
      }

      if (payload.type !== "refresh") {
        unauthorized(res, "Invalid token type");
        return;
      }

      // Check DB record (rotation: old token must not be revoked)
      const hash = hashToken(refresh_token);
      const record = db.prepare(
        "SELECT * FROM refresh_tokens WHERE token_hash = ?"
      ).get(hash) as RefreshTokenRow | undefined;

      if (!record || record.revoked || new Date(record.expires_at) < new Date()) {
        unauthorized(res, "Refresh token is invalid or has been revoked");
        return;
      }

      // Revoke the used token (rotation)
      db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?").run(record.id);

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(record.user_id) as UserRow | undefined;
      if (!user || !user.is_active) {
        unauthorized(res, "Account is inactive");
        return;
      }

      const tokens = await issueTokenPair(user);
      ok(res, tokens);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /auth/logout ─────────────────────────────────────────────────────────

authRouter.post(
  "/logout",
  validate({ body: RefreshSchema }),
  async (req, res, next) => {
    try {
      const { refresh_token } = req.body as z.infer<typeof RefreshSchema>;
      const db = getDb();
      const hash = hashToken(refresh_token);

      db.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").run(hash);

      ok(res, { message: "Logged out successfully" });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /auth/me ──────────────────────────────────────────────────────────────

authRouter.get("/me", authenticate, (req, res, next) => {
  try {
    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user!.id) as UserRow | undefined;

    if (!user) {
      notFound(res, "User not found");
      return;
    }

    ok(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
});



