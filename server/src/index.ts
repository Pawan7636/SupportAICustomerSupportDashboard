/**
 * SupportAI Backend — Entry point
 *
 * Start:
 *   npm run dev        (development, with hot reload)
 *   npm run build && npm start  (production)
 */
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { closeDb } from "./db/database";
import { runSchema } from "./db/autoMigrate";
import { authRouter } from "./routes/auth";
import { ticketsRouter } from "./routes/tickets";
import { repliesRouter } from "./routes/replies";
import { usersRouter } from "./routes/users";
import { chatRouter } from "./routes/chat";
import { kbRouter } from "./routes/knowledgeBase";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  App setup
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env["CORS_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header = same-origin request (or curl) → always allow
      if (!origin) { callback(null, true); return; }

      // Explicitly listed origins
      if (allowedOrigins.includes(origin)) { callback(null, true); return; }

      // Any localhost / 127.0.0.1 origin is allowed in development
      if (process.env["NODE_ENV"] !== "production" &&
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ── Request parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// ── HTTP logging ──────────────────────────────────────────────────────────────
app.use(
  morgan(process.env["NODE_ENV"] === "production" ? "combined" : "dev", {
    stream: {
      write: (message: string) => logger.info(message.trim()),
    },
  })
);

// ── Global rate limiting ──────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests, please try again later" },
  })
);

// Tighter rate limit on auth endpoints to combat brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many authentication attempts" },
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok", ts: new Date().toISOString() } });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",    authLimiter, authRouter);
app.use("/api/chat",   chatRouter);
app.use("/api/kb",     kbRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/tickets/:ticketId/replies", repliesRouter);
app.use("/api/users", usersRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // Auto-apply schema on startup (idempotent)
  await runSchema();

  const port = parseInt(process.env["PORT"] ?? "3001", 10);

  const server = app.listen(port, () => {
    logger.info("Server started", {
      port,
      env: process.env["NODE_ENV"] ?? "development",
    });
  });

  // Graceful shutdown
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  logger.error("Failed to start server", { error: String(err) });
  process.exit(1);
});

// Expose app for testing
export default app;
