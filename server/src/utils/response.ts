import type { Response } from "express";

// ─────────────────────────────────────────────────────────────────────────────
//  Consistent JSON envelope for every API response
//  Success:  { success: true,  data: T,      meta?: PaginationMeta }
//  Failure:  { success: false, error: string, details?: unknown }
// ─────────────────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function ok<T>(
  res: Response,
  data: T,
  meta?: PaginationMeta,
  status = 200,
): Response {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, undefined, 201);
}

export function noContent(res: Response): Response {
  return res.status(204).end();
}

export function badRequest(res: Response, message: string, details?: unknown): Response {
  return res.status(400).json({ success: false, error: message, ...(details ? { details } : {}) });
}

export function unauthorized(res: Response, message = "Unauthorized"): Response {
  return res.status(401).json({ success: false, error: message });
}

export function forbidden(res: Response, message = "Forbidden"): Response {
  return res.status(403).json({ success: false, error: message });
}

export function notFound(res: Response, message = "Not found"): Response {
  return res.status(404).json({ success: false, error: message });
}

export function conflict(res: Response, message: string): Response {
  return res.status(409).json({ success: false, error: message });
}

export function serverError(res: Response, message = "Internal server error"): Response {
  return res.status(500).json({ success: false, error: message });
}
