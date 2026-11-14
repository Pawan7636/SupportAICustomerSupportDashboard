-- ─────────────────────────────────────────────────────────────────────────────
--  SupportAI Database Schema
--  SQLite — all timestamps stored as ISO-8601 strings in UTC
--  NOTE: PRAGMAs (journal_mode, foreign_keys, etc.) are set in database.ts,
--        not here, because PRAGMA journal_mode returns a row and cannot be
--        run via exec() in node:sqlite.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('customer', 'agent', 'admin')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role);

-- ── Refresh tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- ── Tickets ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id                TEXT PRIMARY KEY,
  subject           TEXT NOT NULL,
  description       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'pending', 'in_progress', 'resolved', 'closed')),
  priority          TEXT NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  category          TEXT NOT NULL DEFAULT 'general'
                      CHECK (category IN ('orders', 'payments', 'refunds', 'account', 'technical', 'general')),
  customer_id       TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assigned_agent_id TEXT          REFERENCES users (id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer   ON tickets (customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_agent      ON tickets (assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status     ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority   ON tickets (priority);
CREATE INDEX IF NOT EXISTS idx_tickets_category   ON tickets (category);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets (created_at DESC);

-- ── Ticket replies / internal notes ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replies (
  id               TEXT PRIMARY KEY,
  ticket_id        TEXT    NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  author_id        TEXT    NOT NULL REFERENCES users   (id) ON DELETE RESTRICT,
  body             TEXT    NOT NULL,
  is_internal_note INTEGER NOT NULL DEFAULT 0 CHECK (is_internal_note IN (0, 1)),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_replies_ticket     ON replies (ticket_id);
CREATE INDEX IF NOT EXISTS idx_replies_author     ON replies (author_id);
CREATE INDEX IF NOT EXISTS idx_replies_created_at ON replies (created_at);

-- ── Knowledge base articles (RAG source) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_base (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general'
                CHECK (category IN ('orders', 'payments', 'refunds', 'account', 'technical', 'general')),
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON array of tag strings
  embedding   TEXT,                         -- JSON array of floats (text-embedding-004, 768-dim)
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_kb_category   ON knowledge_base (category);
CREATE INDEX IF NOT EXISTS idx_kb_is_active  ON knowledge_base (is_active);
CREATE INDEX IF NOT EXISTS idx_kb_created_at ON knowledge_base (created_at DESC);

-- ── Audit log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  actor_id   TEXT NOT NULL REFERENCES users   (id) ON DELETE RESTRICT,
  action     TEXT NOT NULL
               CHECK (action IN ('created','status_changed','priority_changed',
                                 'assigned','unassigned','reply_added','note_added','closed')),
  old_value  TEXT,
  new_value  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_ticket     ON audit_log (ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log (created_at DESC);
