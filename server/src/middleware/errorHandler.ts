import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Global error handler — must be registered last with app.use()
//  Handles:
//    • ZodError  → 400 with field-level details
//    • known JS errors → 500 with sanitized message
// ─────────────────────────────────────────────────────────────────────────────

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: "Validation error",
      details: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
    return;
  }

  // Log the full error server-side, never leak internals to the client
  logger.error("Unhandled error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({ success: false, error: "Internal server error" });
};
