import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { unauthorized, forbidden } from "../utils/response";
import type { UserRole } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
//  authenticate — verifies the Bearer JWT in the Authorization header.
//  Attaches req.user on success; returns 401 on any failure.
// ─────────────────────────────────────────────────────────────────────────────

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    unauthorized(res);
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAccessToken(token);

    if (payload.type !== "access") {
      unauthorized(res, "Invalid token type");
      return;
    }

    req.user = {
      id: payload.sub,
      email: payload.email as string,
      role: payload.role as UserRole,
    };

    next();
  } catch {
    // JWTExpired, JWSSignatureVerificationFailed, etc.
    unauthorized(res, "Invalid or expired token");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  requireRoles — restrict an endpoint to specific roles.
//  Must be used AFTER authenticate.
// ─────────────────────────────────────────────────────────────────────────────

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      unauthorized(res);
      return;
    }
    if (!roles.includes(req.user.role)) {
      forbidden(res);
      return;
    }
    next();
  };
}
