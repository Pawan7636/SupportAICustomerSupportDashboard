import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Database singleton using Node's built-in node:sqlite (Node 22.5+).
//  No native compilation required — zero extra dependencies.
//  Call getDb() everywhere; the connection is opened once.
// ─────────────────────────────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;

  const dbPath = process.env["DB_PATH"] ?? "./data/support.db";
  const resolved = path.resolve(process.cwd(), dbPath);

  // Ensure the data directory exists
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new DatabaseSync(resolved);

  // Performance + integrity settings
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA busy_timeout = 5000");
  _db.exec("PRAGMA synchronous = NORMAL");

  logger.info("Database opened", { path: resolved });
  return _db;
}

/** Gracefully close the database on process exit */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    logger.info("Database closed");
  }
}
