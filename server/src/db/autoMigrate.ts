/**
 * Auto-migration: reads schema.sql and applies it in a single exec() call.
 *
 * node:sqlite's DatabaseSync.exec() accepts a multi-statement SQL string
 * for DDL (CREATE TABLE, CREATE INDEX, etc.). We pass the whole file at once
 * so trigger bodies with internal semicolons are never accidentally split.
 *
 * PRAGMAs are intentionally excluded from schema.sql and are set directly
 * on the connection in database.ts (PRAGMA journal_mode returns a row,
 * which makes exec() throw in node:sqlite).
 */
import fs from "fs";
import path from "path";
import { getDb } from "./database";
import { logger } from "../utils/logger";

export async function runSchema(): Promise<void> {
  const db = getDb();

  // Locate schema.sql — works in both tsx dev mode (src/) and compiled (dist/)
  const candidates = [
    path.resolve(__dirname, "schema.sql"),
    path.resolve(__dirname, "../db/schema.sql"),
    path.resolve(process.cwd(), "src/db/schema.sql"),
  ];

  const schemaPath = candidates.find((p) => fs.existsSync(p));
  if (!schemaPath) {
    throw new Error(`schema.sql not found. Searched:\n${candidates.join("\n")}`);
  }

  const schema = fs.readFileSync(schemaPath, "utf8");

  // Strip comment-only lines to keep error messages cleaner
  const cleaned = schema
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();

  try {
    // Single exec() call — handles the full DDL file atomically
    db.exec(cleaned);
  } catch (err) {
    logger.error("Schema migration failed", { error: String(err) });
    throw err;
  }

  logger.info("Schema applied", { path: schemaPath });
}
