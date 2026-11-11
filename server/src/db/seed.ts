/**
 * Development seed data — creates demo accounts and sample tickets.
 * Run ONLY in development: npm run seed
 *
 * Seed accounts (all passwords = "Password1!"):
 *   admin@supportai.dev   — admin
 *   agent1@supportai.dev  — agent
 *   agent2@supportai.dev  — agent
 *   customer1@example.com — customer
 *   customer2@example.com — customer
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { getDb, closeDb } from "./database";
import { logger } from "../utils/logger";

const DEMO_PASSWORD = "Password1!";

async function seed(): Promise<void> {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("Seed must not be run in production");
  }

  const db = getDb();
  const rounds = parseInt(process.env["BCRYPT_ROUNDS"] ?? "10", 10);
  const hash = await bcrypt.hash(DEMO_PASSWORD, rounds);

  const now = new Date().toISOString();
  const adminId  = uuid();
  const agent1Id = uuid();
  const agent2Id = uuid();
  const cust1Id  = uuid();
  const cust2Id  = uuid();

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users
      (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES (@id, @email, @password_hash, @full_name, @role, 1, @created_at, @updated_at)
  `);

  const insertTicket = db.prepare(`
    INSERT OR IGNORE INTO tickets
      (id, subject, description, status, priority, category,
       customer_id, assigned_agent_id, created_at, updated_at)
    VALUES
      (@id, @subject, @description, @status, @priority, @category,
       @customer_id, @assigned_agent_id, @created_at, @updated_at)
  `);

  const insertReply = db.prepare(`
    INSERT OR IGNORE INTO replies
      (id, ticket_id, author_id, body, is_internal_note, created_at, updated_at)
    VALUES (@id, @ticket_id, @author_id, @body, @is_internal_note, @created_at, @updated_at)
  `);

  const insertAudit = db.prepare(`
    INSERT OR IGNORE INTO audit_log
      (id, ticket_id, actor_id, action, old_value, new_value, created_at)
    VALUES (@id, @ticket_id, @actor_id, @action, @old_value, @new_value, @created_at)
  `);

  db.exec("BEGIN");
  try {
    // ── Users ────────────────────────────────────────────────────────────────
    insertUser.run({ id: adminId,  email: "admin@supportai.dev",   password_hash: hash, full_name: "Admin User",    role: "admin",    created_at: now, updated_at: now });
    insertUser.run({ id: agent1Id, email: "agent1@supportai.dev",  password_hash: hash, full_name: "Olivia Martin", role: "agent",    created_at: now, updated_at: now });
    insertUser.run({ id: agent2Id, email: "agent2@supportai.dev",  password_hash: hash, full_name: "Marcus Lee",    role: "agent",    created_at: now, updated_at: now });
    insertUser.run({ id: cust1Id,  email: "customer1@example.com", password_hash: hash, full_name: "Maya Thompson", role: "customer", created_at: now, updated_at: now });
    insertUser.run({ id: cust2Id,  email: "customer2@example.com", password_hash: hash, full_name: "Liam Walker",   role: "customer", created_at: now, updated_at: now });

    // ── Ticket 1 ─────────────────────────────────────────────────────────────
    const ticket1Id = uuid();
    insertTicket.run({
      id: ticket1Id, subject: "Order tracking not working",
      description: "I cannot see my tracking link for order #8721.",
      status: "open", priority: "high", category: "orders",
      customer_id: cust1Id, assigned_agent_id: agent1Id,
      created_at: now, updated_at: now,
    });
    insertAudit.run({ id: uuid(), ticket_id: ticket1Id, actor_id: cust1Id, action: "created", old_value: null, new_value: null, created_at: now });

    // ── Ticket 2 ─────────────────────────────────────────────────────────────
    const ticket2Id = uuid();
    insertTicket.run({
      id: ticket2Id, subject: "Charged twice for subscription",
      description: "I was billed twice this month for my annual plan.",
      status: "in_progress", priority: "urgent", category: "payments",
      customer_id: cust2Id, assigned_agent_id: agent1Id,
      created_at: now, updated_at: now,
    });
    insertReply.run({ id: uuid(), ticket_id: ticket2Id, author_id: agent1Id, body: "I have escalated this to our billing team. They will resolve it within 24 hours.", is_internal_note: 0, created_at: now, updated_at: now });
    insertReply.run({ id: uuid(), ticket_id: ticket2Id, author_id: agent1Id, body: "Billing confirmed duplicate charge. Refund initiated.", is_internal_note: 1, created_at: now, updated_at: now });
    insertAudit.run({ id: uuid(), ticket_id: ticket2Id, actor_id: cust2Id,  action: "created",        old_value: null,   new_value: null,          created_at: now });
    insertAudit.run({ id: uuid(), ticket_id: ticket2Id, actor_id: agent1Id, action: "status_changed", old_value: "open", new_value: "in_progress", created_at: now });

    // ── Ticket 3 ─────────────────────────────────────────────────────────────
    const ticket3Id = uuid();
    insertTicket.run({
      id: ticket3Id, subject: "Refund not received after 10 days",
      description: "I returned my item 10 days ago but have not received my refund.",
      status: "pending", priority: "medium", category: "refunds",
      customer_id: cust1Id, assigned_agent_id: null,
      created_at: now, updated_at: now,
    });
    insertAudit.run({ id: uuid(), ticket_id: ticket3Id, actor_id: cust1Id, action: "created", old_value: null, new_value: null, created_at: now });

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  logger.info("Seed data inserted successfully");
}

seed()
  .catch((err) => {
    logger.error("Seed failed", { error: String(err) });
    process.exit(1);
  })
  .finally(() => closeDb());
