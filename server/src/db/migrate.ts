/**
 * Standalone migration CLI — applies schema.sql to the database.
 * Safe to run multiple times (all statements are idempotent).
 *
 * Usage:
 *   npm run migrate
 */
import "dotenv/config";
import { runSchema } from "./autoMigrate";
import { closeDb } from "./database";
import { logger } from "../utils/logger";

runSchema()
  .then(() => logger.info("Migrations applied successfully"))
  .catch((err) => {
    logger.error("Migration failed", { error: String(err) });
    process.exit(1);
  })
  .finally(() => closeDb());
