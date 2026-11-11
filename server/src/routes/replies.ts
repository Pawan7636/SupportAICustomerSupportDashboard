import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { getDb } from "../db/database";
import { authenticate, requireRoles } from "../middleware/authenticate";
import { validate } from "../middleware/validate";
import { ok, created, noContent, notFound, forbidden } from "../utils/response";
import type { TicketRow, ReplyRow } from "../types";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Replies router (mounted under /tickets/:ticketId/replies)
//
//  GET    /tickets/:ticketId/replies        — list replies
//  POST   /tickets/:ticketId/replies        — add reply or internal note
//  PATCH  /tickets/:ticketId/replies/:id    — edit reply (author or admin)
//  DELETE /tickets/:ticketId/replies/:id    — delete reply (admin)
// ─────────────────────────────────────────────────────────────────────────────

export const repliesRouter = Router({ mergeParams: true });
repliesRouter.use(authenticate);

// ── Validation ────────────────────────────────────────────────────────────────

const TicketIdParam = z.object({ ticketId: z.string().uuid() });
const ReplyIdParam  = z.object({ ticketId: z.string().uuid(), id: z.string().uuid() });

const CreateReplySchema = z.object({
  body: z.string().min(1).max(20000).trim(),
  is_internal_note: z.boolean().default(false),
});

const UpdateReplySchema = z.object({
  body: z.string().min(1).max(20000).trim(),
});

// ── Helper: verify ticket exists and actor has access ─────────────────────────

function getAccessibleTicket(ticketId: string, actorId: string, role: string): TicketRow | null {
  const db = getDb();
  const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId) as TicketRow | undefined;
  if (!ticket) return null;
  if (role === "customer" && ticket.customer_id !== actorId) return null;
  return ticket;
}

// ── GET /tickets/:ticketId/replies ────────────────────────────────────────────

repliesRouter.get(
  "/",
  validate({ params: TicketIdParam }),
  (req, res, next) => {
    try {
      const { ticketId } = req.params as { ticketId: string };
      const actor = req.user!;
      const db = getDb();

      const ticket = getAccessibleTicket(ticketId, actor.id, actor.role);
      if (!ticket) { notFound(res); return; }

      // Customers cannot see internal notes
      const noteFilter = actor.role === "customer" ? "AND r.is_internal_note = 0" : "";

      const replies = db.prepare(`
        SELECT r.*,
          u.full_name AS author_name,
          u.email     AS author_email,
          u.role      AS author_role
        FROM replies r
        LEFT JOIN users u ON u.id = r.author_id
        WHERE r.ticket_id = ? ${noteFilter}
        ORDER BY r.created_at ASC
      `).all(ticketId) as (ReplyRow & { author_name: string; author_email: string; author_role: string })[];

      ok(res, replies.map((r) => ({ ...r, is_internal_note: Boolean(r.is_internal_note) })));
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /tickets/:ticketId/replies ───────────────────────────────────────────

repliesRouter.post(
  "/",
  validate({ params: TicketIdParam, body: CreateReplySchema }),
  (req, res, next) => {
    try {
      const { ticketId } = req.params as { ticketId: string };
      const actor = req.user!;
      const body = req.body as z.infer<typeof CreateReplySchema>;
      const db = getDb();

      const ticket = getAccessibleTicket(ticketId, actor.id, actor.role);
      if (!ticket) { notFound(res); return; }

      // Only staff can create internal notes
      if (body.is_internal_note && actor.role === "customer") {
        forbidden(res, "Customers cannot create internal notes");
        return;
      }

      // Closed tickets: only staff can reply
      if (ticket.status === "closed" && actor.role === "customer") {
        forbidden(res, "This ticket is closed");
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO replies (id, ticket_id, author_id, body, is_internal_note, created_at, updated_at)
        VALUES (@id, @ticket_id, @author_id, @body, @is_internal_note, @now, @now)
      `).run({
        id, ticket_id: ticketId, author_id: actor.id,
        body: body.body, is_internal_note: body.is_internal_note ? 1 : 0, now,
      });

      // Audit
      db.prepare(`
        INSERT INTO audit_log (id, ticket_id, actor_id, action, old_value, new_value)
        VALUES (@id, @ticket_id, @actor_id, @action, NULL, NULL)
      `).run({
        id: uuid(), ticket_id: ticketId, actor_id: actor.id,
        action: body.is_internal_note ? "note_added" : "reply_added",
      });

      // Reopen ticket if it was resolved and customer replies
      if (ticket.status === "resolved" && actor.role === "customer" && !body.is_internal_note) {
        db.prepare("UPDATE tickets SET status = 'open', updated_at = ? WHERE id = ?").run(now, ticketId);
      }

      const reply = db.prepare(`
        SELECT r.*, u.full_name AS author_name, u.email AS author_email, u.role AS author_role
        FROM replies r LEFT JOIN users u ON u.id = r.author_id WHERE r.id = ?
      `).get(id) as ReplyRow & { author_name: string; author_email: string; author_role: string };

      logger.info("Reply added", { ticketId, replyId: id, isNote: body.is_internal_note });
      created(res, { ...reply, is_internal_note: Boolean(reply.is_internal_note) });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /tickets/:ticketId/replies/:id ──────────────────────────────────────

repliesRouter.patch(
  "/:id",
  validate({ params: ReplyIdParam, body: UpdateReplySchema }),
  (req, res, next) => {
    try {
      const { ticketId, id: replyId } = req.params as { ticketId: string; id: string };
      const actor = req.user!;
      const db = getDb();

      const ticket = getAccessibleTicket(ticketId, actor.id, actor.role);
      if (!ticket) { notFound(res); return; }

      const reply = db.prepare("SELECT * FROM replies WHERE id = ? AND ticket_id = ?").get(replyId, ticketId) as ReplyRow | undefined;
      if (!reply) { notFound(res); return; }

      // Customers cannot see/edit internal notes
      if (reply.is_internal_note && actor.role === "customer") { notFound(res); return; }

      // Only the author or admin can edit
      if (actor.id !== reply.author_id && actor.role !== "admin") {
        forbidden(res, "You can only edit your own replies");
        return;
      }

      const now = new Date().toISOString();
      db.prepare("UPDATE replies SET body = @body, updated_at = @now WHERE id = @id")
        .run({ body: (req.body as z.infer<typeof UpdateReplySchema>).body, now, id: replyId });

      const updated = db.prepare("SELECT * FROM replies WHERE id = ?").get(replyId) as ReplyRow;
      ok(res, { ...updated, is_internal_note: Boolean(updated.is_internal_note) });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /tickets/:ticketId/replies/:id ─────────────────────────────────────

repliesRouter.delete(
  "/:id",
  requireRoles("admin"),
  validate({ params: ReplyIdParam }),
  (req, res, next) => {
    try {
      const { ticketId, id: replyId } = req.params as { ticketId: string; id: string };
      const db = getDb();

      const reply = db.prepare("SELECT id FROM replies WHERE id = ? AND ticket_id = ?").get(replyId, ticketId);
      if (!reply) { notFound(res); return; }

      db.prepare("DELETE FROM replies WHERE id = ?").run(replyId);
      noContent(res);
    } catch (err) {
      next(err);
    }
  }
);
