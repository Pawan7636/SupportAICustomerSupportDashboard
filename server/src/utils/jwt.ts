import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
//  JWT helpers using the `jose` library (no legacy jsonwebtoken)
// ─────────────────────────────────────────────────────────────────────────────

function getSecret(envVar: string): Uint8Array {
  const value = process.env[envVar];
  if (!value || value.length < 32) {
    throw new Error(`Environment variable ${envVar} is missing or too short (min 32 chars)`);
  }
  return new TextEncoder().encode(value);
}

export interface TokenPayload extends JWTPayload {
  sub: string;       // user id
  email: string;
  role: string;
  type: "access" | "refresh";
}

export async function signAccessToken(payload: {
  sub: string;
  email: string;
  role: string;
}): Promise<string> {
  const secret = getSecret("JWT_ACCESS_SECRET");
  const expiresIn = process.env["JWT_ACCESS_EXPIRES_IN"] ?? "15m";

  return new SignJWT({ ...payload, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function signRefreshToken(payload: {
  sub: string;
  email: string;
  role: string;
}): Promise<string> {
  const secret = getSecret("JWT_REFRESH_SECRET");
  const expiresIn = process.env["JWT_REFRESH_EXPIRES_IN"] ?? "7d";

  return new SignJWT({ ...payload, type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const secret = getSecret("JWT_ACCESS_SECRET");
  const { payload } = await jwtVerify(token, secret);
  return payload as TokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload> {
  const secret = getSecret("JWT_REFRESH_SECRET");
  const { payload } = await jwtVerify(token, secret);
  return payload as TokenPayload;
}

/** Stores a hashed version of the refresh token in DB (never raw token) */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Generates a cryptographically random opaque token for refresh */
export function generateOpaqueToken(): string {
  return randomBytes(64).toString("hex");
}
