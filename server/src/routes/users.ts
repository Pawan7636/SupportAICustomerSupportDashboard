import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { getDb } from "../db/database";
import { authenticate, requireRoles } from "../middleware/authenticate";
import { validate } from "../middleware/validate";
import { ok, created, noContent, badRequest, notFound, conflict, forbidden } from "../utils/response";
import type { UserRow } from "../types";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Users router (admin management of user accounts)
//  All routes require authentication; most require admin.
//
//  GET    /users           — list users (admin)
//  POST   /users           — create agent/admin account (admin)
//  GET    /users/:id       — get user by id (admin, or own profile)
//  PATCH  /users/:id       — update user (admin, or own profile for name/password)
//  DELETE /users/:id       — deactivate user (admin)
// ─────────────────────────────────────────────────────────────────────────────

export const usersRouter = Router();
usersRouter.use(authenticate);

// ── Validation schemas ────────────────────────────────────────────────────────

const ListUsersSchema = z.object({
  role: z.enum(["customer", "agent", "admin"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["created_at", "full_name", "email"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const CreateUserSchema = z.object({
  email: z.string().email().max(254).toLowerCase(),
  password: z
    .string()
    .min(8).max(128)
    .regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  full_name: z.string().min(1).max(120).trim(),
  role: z.enum(["agent", "admin"]),
});

const UpdateUserSchema = z.object({
  full_name: z.string().min(1).max(120).trim().optional(),
  password: z
    .string().min(8).max(128)
    .regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/)
    .optional(),
  is_active: z.boolean().optional(),
  role: z.enum(["customer", "agent", "admin"]).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

function sanitizeUser(user: UserRow) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash: _ph, ...safe } = user;
  return { ...safe, is_active: Boolean(safe.is_active) };
}

// ── GET /users ────────────────────────────────────────────────────────────────

usersRouter.get(
  "/",
  requireRoles("admin"),
  validate({ query: ListUsersSchema }),
  (req, res, next) => {
    try {
      const { role, page, pageSize, sort, order } = req.query as unknown as z.infer<typeof ListUsersSchema>;
      const db = getDb();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (role) {
        conditions.push("role = @role");
        params["role"] = role;
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const orderClause = `ORDER BY ${sort} ${order}`;

      const total = (db.prepare(`SELECT COUNT(*) as cnt FROM users ${where}`).get(params) as { cnt: number }).cnt;
      const rows = db.prepare(
        `SELECT * FROM users ${where} ${orderClause} LIMIT @limit OFFSET @offset`
      ).all({ ...params, limit: pageSize, offset }) as UserRow[];

      ok(res, rows.map(sanitizeUser), {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /users ───────────────────────────────────────────────────────────────

usersRouter.post(
  "/",
  requireRoles("admin"),
  validate({ body: CreateUserSchema }),
  async (req, res, next) => {
    try {
      const { email, password, full_name, role } = req.body as z.infer<typeof CreateUserSchema>;
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
        VALUES (@id, @email, @password_hash, @full_name, @role, 1, @now, @now)
      `).run({ id, email, password_hash, full_name, role, now });

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;

      logger.info("User created by admin", { actorId: req.user!.id, newUserId: id, role });
      created(res, sanitizeUser(user));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /users/:id ────────────────────────────────────────────────────────────

usersRouter.get("/:id", validate({ params: z.object({ id: z.string().uuid() }) }), (req, res, next) => {
  try {
    const { id } = req.params;
    const actor = req.user!;

    // Customers can only view their own profile; agents/admins can view all
    if (actor.role === "customer" && actor.id !== id) {
      forbidden(res);
      return;
    }

    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;

    if (!user) {
      notFound(res);
      return;
    }

    ok(res, sanitizeUser(user));
  } catch (err) {
    next(err);
  }
});

// ── PATCH /users/:id ──────────────────────────────────────────────────────────

usersRouter.patch(
  "/:id",
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: UpdateUserSchema,
  }),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const actor = req.user!;
      const body = req.body as z.infer<typeof UpdateUserSchema>;

      // Customers can only edit their own name/password; admins can edit all fields
      if (actor.role === "customer") {
        if (actor.id !== id) { forbidden(res); return; }
        // Customers cannot change role or is_active
        if (body.role || body.is_active !== undefined) {
          forbidden(res, "Customers cannot change role or account status");
          return;
        }
      }

      // Agents cannot modify other agents or admins
      if (actor.role === "agent" && actor.id !== id) {
        forbidden(res);
        return;
      }

      const db = getDb();
      const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
      if (!existing) { notFound(res); return; }

      const setClauses: string[] = [];
      const params: Record<string, unknown> = { id };

      if (body.full_name !== undefined) {
        setClauses.push("full_name = @full_name");
        params["full_name"] = body.full_name;
      }
      if (body.password !== undefined) {
        const rounds = parseInt(process.env["BCRYPT_ROUNDS"] ?? "12", 10);
        params["password_hash"] = await bcrypt.hash(body.password, rounds);
        setClauses.push("password_hash = @password_hash");
      }
      if (body.is_active !== undefined && actor.role === "admin") {
        setClauses.push("is_active = @is_active");
        params["is_active"] = body.is_active ? 1 : 0;
      }
      if (body.role !== undefined && actor.role === "admin") {
        setClauses.push("role = @role");
        params["role"] = body.role;
      }

      if (setClauses.length === 0) {
        badRequest(res, "No valid fields to update");
        return;
      }

      setClauses.push("updated_at = @updated_at");
      params["updated_at"] = new Date().toISOString();

      db.prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = @id`).run(params);

      const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
      ok(res, sanitizeUser(updated));
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /users/:id (deactivate) ───────────────────────────────────────────

usersRouter.delete(
  "/:id",
  requireRoles("admin"),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  (req, res, next) => {
    try {
      const { id } = req.params;
      const actor = req.user!;

      if (actor.id === id) {
        badRequest(res, "You cannot deactivate your own account");
        return;
      }

      const db = getDb();
      const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
      if (!user) { notFound(res); return; }

      db.prepare("UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), id);

      logger.info("User deactivated", { actorId: actor.id, targetId: id });
      noContent(res);
    } catch (err) {
      next(err);
    }
  }
);
