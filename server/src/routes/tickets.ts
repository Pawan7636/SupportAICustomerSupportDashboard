import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { getDb } from "../db/database";
import { authenticate, requireRoles } from "../middleware/authenticate";
import { validate } from "../middleware/validate";
import { ok, created, noContent, badRequest, notFound, forbidden } from "../utils/response";
import type { TicketRow, UserRow, AuditAction } from "../types";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Tickets router
//
//  GET    /tickets                  — list (customer: own; agent/admin: all)
//  POST   /tickets                  — create ticket (any authenticated user)
//  GET    /tickets/:id              — get single ticket
//  PATCH  /tickets/:id              — update subject/description/priority/category
//  PATCH  /tickets/:id/status       — change status (agent/admin)
//  PATCH  /tickets/:id/assign       — assign agent (agent/admin)
//  DELETE /tickets/:id              — delete ticket (admin only)
//  GET    /tickets/:id/audit        — audit history
// ─────────────────────────────────────────────────────────────────────────────

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

// ── Shared helpers ────────────────────────────────────────────────────────────

function addAuditEntry(opts: {
  ticket_id: string;
  actor_id: string;
  action: AuditAction;
  old_value?: string | null;
  new_value?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (id, ticket_id, actor_id, action, old_value, new_value)
    VALUES (@id, @ticket_id, @actor_id, @action, @old_value, @new_value)
  `).run({
    id: uuid(),
    ticket_id: opts.ticket_id,
    actor_id: opts.actor_id,
    action: opts.action,
    old_value: opts.old_value ?? null,
    new_value: opts.new_value ?? null,
  });
}

function assertTicketAccess(ticket: TicketRow | undefined, actorId: string, role: string): ticket is TicketRow {
  if (!ticket) return false;
  if (role === "customer" && ticket.customer_id !== actorId) return false;
  return true;
}

// ── Validation schemas ────────────────────────────────────────────────────────

const ListTicketsSchema = z.object({
  status:   z.enum(["open","pending","in_progress","resolved","closed"]).optional(),
  priority: z.enum(["low","medium","high","urgent"]).optional(),
  category: z.enum(["orders","payments","refunds","account","technical","general"]).optional(),
  customer_id:       z.string().uuid().optional(),
  assigned_agent_id: z.string().uuid().optional(),
  q:        z.string().max(200).optional(), // full-text search
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort:     z.enum(["created_at","updated_at","priority","status"]).default("created_at"),
  order:    z.enum(["asc","desc"]).default("desc"),
});

const CreateTicketSchema = z.object({
  subject:     z.string().min(3).max(200).trim(),
  description: z.string().min(10).max(10000).trim(),
  priority:    z.enum(["low","medium","high","urgent"]).default("medium"),
  category:    z.enum(["orders","payments","refunds","account","technical","general"]).default("general"),
});

const UpdateTicketSchema = z.object({
  subject:     z.string().min(3).max(200).trim().optional(),
  description: z.string().min(10).max(10000).trim().optional(),
  priority:    z.enum(["low","medium","high","urgent"]).optional(),
  category:    z.enum(["orders","payments","refunds","account","technical","general"]).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

const UpdateStatusSchema = z.object({
  status: z.enum(["open","pending","in_progress","resolved","closed"]),
});

const AssignSchema = z.object({
  agent_id: z.string().uuid().nullable(),
});

const IdParam = z.object({ id: z.string().uuid() });

// ── GET /tickets ──────────────────────────────────────────────────────────────

ticketsRouter.get(
  "/",
  validate({ query: ListTicketsSchema }),
  (req, res, next) => {
    try {
      const actor = req.user!;
      const q = req.query as unknown as z.infer<typeof ListTicketsSchema>;
      const db = getDb();

      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      // Customers see only their own tickets
      if (actor.role === "customer") {
        conditions.push("t.customer_id = @customer_id_self");
        params["customer_id_self"] = actor.id;
      } else {
        // Agent/admin can filter by customer
        if (q.customer_id) { conditions.push("t.customer_id = @customer_id"); params["customer_id"] = q.customer_id; }
        if (q.assigned_agent_id) { conditions.push("t.assigned_agent_id = @assigned_agent_id"); params["assigned_agent_id"] = q.assigned_agent_id; }
      }

      if (q.status)   { conditions.push("t.status = @status");     params["status"]   = q.status; }
      if (q.priority) { conditions.push("t.priority = @priority");  params["priority"] = q.priority; }
      if (q.category) { conditions.push("t.category = @category");  params["category"] = q.category; }

      let joins = "";
      if (q.q) {
        // Full-text search via FTS5
        joins = "JOIN tickets_fts ON tickets_fts.rowid = t.rowid";
        conditions.push("tickets_fts MATCH @fts_query");
        params["fts_query"] = q.q.replace(/[^a-zA-Z0-9 ]/g, "") + "*";
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const offset = (q.page - 1) * q.pageSize;

      // Validate sort column to prevent SQL injection (already done by zod enum)
      const sortCol = `t.${q.sort}`;
      const order = q.order.toUpperCase() === "ASC" ? "ASC" : "DESC";

      const total = (db.prepare(
        `SELECT COUNT(*) as cnt FROM tickets t ${joins} ${where}`
      ).get(params) as { cnt: number }).cnt;

      const rows = db.prepare(`
        SELECT t.*,
          c.full_name  AS customer_name,
          c.email      AS customer_email,
          ag.full_name AS agent_name
        FROM tickets t
        ${joins}
        LEFT JOIN users c  ON c.id = t.customer_id
        LEFT JOIN users ag ON ag.id = t.assigned_agent_id
        ${where}
        ORDER BY ${sortCol} ${order}
        LIMIT @limit OFFSET @offset
      `).all({ ...params, limit: q.pageSize, offset }) as (TicketRow & {
        customer_name: string;
        customer_email: string;
        agent_name: string | null;
      })[];

      ok(res, rows, { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /tickets ─────────────────────────────────────────────────────────────

ticketsRouter.post(
  "/",
  validate({ body: CreateTicketSchema }),
  (req, res, next) => {
    try {
      const actor = req.user!;
      const body = req.body as z.infer<typeof CreateTicketSchema>;
      const db = getDb();

      const id = uuid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO tickets (id, subject, description, status, priority, category, customer_id, assigned_agent_id, created_at, updated_at)
        VALUES (@id, @subject, @description, 'open', @priority, @category, @customer_id, NULL, @now, @now)
      `).run({ id, ...body, customer_id: actor.id, now });

      addAuditEntry({ ticket_id: id, actor_id: actor.id, action: "created" });

      const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow;
      logger.info("Ticket created", { ticketId: id, customerId: actor.id });
      created(res, ticket);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /tickets/:id ──────────────────────────────────────────────────────────

ticketsRouter.get("/:id", validate({ params: IdParam }), (req, res, next) => {
  try {
    const actor = req.user!;
    const db = getDb();

    const ticket = db.prepare(`
      SELECT t.*,
        c.full_name  AS customer_name,
        c.email      AS customer_email,
        ag.full_name AS agent_name,
        ag.email     AS agent_email
      FROM tickets t
      LEFT JOIN users c  ON c.id = t.customer_id
      LEFT JOIN users ag ON ag.id = t.assigned_agent_id
      WHERE t.id = ?
    `).get(req.params["id"]) as (TicketRow & { customer_name: string; customer_email: string; agent_name: string | null; agent_email: string | null; }) | undefined;

    if (!ticket) { notFound(res); return; }

    if (actor.role === "customer" && ticket.customer_id !== actor.id) {
      notFound(res); // not found rather than forbidden (don't leak existence)
      return;
    }

    ok(res, ticket);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /tickets/:id ────────────────────────────────────────────────────────

ticketsRouter.patch(
  "/:id",
  validate({ params: IdParam, body: UpdateTicketSchema }),
  (req, res, next) => {
    try {
      const actor = req.user!;
      const body = req.body as z.infer<typeof UpdateTicketSchema>;
      const db = getDb();

      const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params["id"]) as TicketRow | undefined;
      if (!ticket) { notFound(res); return; }

      // Customers can only edit their own tickets; they cannot change priority
      if (actor.role === "customer") {
        if (ticket.customer_id !== actor.id) { notFound(res); return; }
        if (body.priority) { forbidden(res, "Customers cannot change priority"); return; }
      }

      const setClauses: string[] = [];
      const params: Record<string, unknown> = { id: ticket.id };

      if (body.subject)     { setClauses.push("subject = @subject");         params["subject"]     = body.subject; }
      if (body.description) { setClauses.push("description = @description"); params["description"] = body.description; }
      if (body.priority)    {
        setClauses.push("priority = @priority");
        params["priority"] = body.priority;
        addAuditEntry({ ticket_id: ticket.id, actor_id: actor.id, action: "priority_changed", old_value: ticket.priority, new_value: body.priority });
      }
      if (body.category)    { setClauses.push("category = @category"); params["category"] = body.category; }

      setClauses.push("updated_at = @updated_at");
      params["updated_at"] = new Date().toISOString();

      db.prepare(`UPDATE tickets SET ${setClauses.join(", ")} WHERE id = @id`).run(params);

      const updated = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id) as TicketRow;
      ok(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /tickets/:id/status ─────────────────────────────────────────────────

ticketsRouter.patch(
  "/:id/status",
  requireRoles("agent", "admin"),
  validate({ params: IdParam, body: UpdateStatusSchema }),
  (req, res, next) => {
    try {
      const actor = req.user!;
      const { status } = req.body as z.infer<typeof UpdateStatusSchema>;
      const db = getDb();

      const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params["id"]) as TicketRow | undefined;
      if (!ticket) { notFound(res); return; }

      if (ticket.status === status) {
        badRequest(res, "Ticket is already in this status");
        return;
      }

      const now = new Date().toISOString();
      const closedAt = status === "closed" ? now : ticket.closed_at;

      db.prepare(`
        UPDATE tickets SET status = @status, updated_at = @now, closed_at = @closed_at WHERE id = @id
      `).run({ status, now, closed_at: closedAt, id: ticket.id });

      addAuditEntry({
        ticket_id: ticket.id, actor_id: actor.id, action:
          status === "closed" ? "closed" : "status_changed",
        old_value: ticket.status, new_value: status,
      });

      logger.info("Ticket status changed", { ticketId: ticket.id, from: ticket.status, to: status });

      const updated = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id) as TicketRow;
      ok(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /tickets/:id/assign ─────────────────────────────────────────────────

ticketsRouter.patch(
  "/:id/assign",
  requireRoles("agent", "admin"),
  validate({ params: IdParam, body: AssignSchema }),
  (req, res, next) => {
    try {
      const actor = req.user!;
      const { agent_id } = req.body as z.infer<typeof AssignSchema>;
      const db = getDb();

      const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params["id"]) as TicketRow | undefined;
      if (!ticket) { notFound(res); return; }

      if (agent_id) {
        const agent = db.prepare("SELECT id, role FROM users WHERE id = ? AND is_active = 1").get(agent_id) as UserRow | undefined;
        if (!agent || (agent.role !== "agent" && agent.role !== "admin")) {
          badRequest(res, "Target user is not an active agent or admin");
          return;
        }
      }

      const now = new Date().toISOString();
      db.prepare("UPDATE tickets SET assigned_agent_id = @agent_id, updated_at = @now WHERE id = @id")
        .run({ agent_id, now, id: ticket.id });

      addAuditEntry({
        ticket_id: ticket.id, actor_id: actor.id,
        action: agent_id ? "assigned" : "unassigned",
        old_value: ticket.assigned_agent_id, new_value: agent_id,
      });

      const updated = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticket.id) as TicketRow;
      ok(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /tickets/:id ───────────────────────────────────────────────────────

ticketsRouter.delete(
  "/:id",
  requireRoles("admin"),
  validate({ params: IdParam }),
  (req, res, next) => {
    try {
      const db = getDb();
      const ticket = db.prepare("SELECT id FROM tickets WHERE id = ?").get(req.params["id"]);
      if (!ticket) { notFound(res); return; }

      db.prepare("DELETE FROM tickets WHERE id = ?").run(req.params["id"]);
      logger.info("Ticket deleted", { ticketId: req.params["id"], actorId: req.user!.id });
      noContent(res);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /tickets/:id/audit ────────────────────────────────────────────────────

ticketsRouter.get(
  "/:id/audit",
  requireRoles("agent", "admin"),
  validate({ params: IdParam }),
  (req, res, next) => {
    try {
      const db = getDb();
      const ticket = db.prepare("SELECT id FROM tickets WHERE id = ?").get(req.params["id"]);
      if (!ticket) { notFound(res); return; }

      const entries = db.prepare(`
        SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.actor_id
        WHERE al.ticket_id = ?
        ORDER BY al.created_at ASC
      `).all(req.params["id"]);

      ok(res, entries);
    } catch (err) {
      next(err);
    }
  }
);
