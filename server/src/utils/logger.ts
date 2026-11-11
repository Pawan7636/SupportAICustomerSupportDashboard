// ─────────────────────────────────────────────────────────────────────────────
//  Minimal structured logger
//  In production pipe stdout to a log aggregator (Datadog, CloudWatch, etc.)
// ─────────────────────────────────────────────────────────────────────────────

type Level = "info" | "warn" | "error" | "debug";

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  const isProd = process.env["NODE_ENV"] === "production";

  if (level === "debug" && isProd) return; // suppress debug in prod

  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ?? {}),
  };

  const output = JSON.stringify(entry);

  if (level === "error") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
};
