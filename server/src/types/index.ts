// ─────────────────────────────────────────────────────────────────────────────
//  Shared TypeScript types used across the backend
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = "customer" | "agent" | "admin";

export type TicketStatus =
  | "open"
  | "pending"
  | "in_progress"
  | "resolved"
  | "closed";

export type TicketPriority = "low" | "medium" | "high" | "urgent";

export type TicketCategory =
  | "orders"
  | "payments"
  | "refunds"
  | "account"
  | "technical"
  | "general";

export type AuditAction =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "assigned"
  | "unassigned"
  | "reply_added"
  | "note_added"
  | "closed";

// ── Database row types (snake_case mirrors DB columns) ────────────────────────

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  is_active: number; // SQLite stores booleans as 0/1
  created_at: string;
  updated_at: string;
}

export interface TicketRow {
  id: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  customer_id: string;
  assigned_agent_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface ReplyRow {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_internal_note: number; // 0 = public reply, 1 = internal note
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  ticket_id: string;
  actor_id: string;
  action: AuditAction;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked: number;
  created_at: string;
}

// ── Express augmentation ──────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      /** Populated by the authenticate middleware after JWT verification */
      user?: {
        id: string;
        email: string;
        role: UserRole;
      };
    }
  }
}
