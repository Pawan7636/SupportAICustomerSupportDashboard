import type { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
//  Zod validation middleware factory
//  Usage: router.post('/route', validate({ body: MySchema }), handler)
// ─────────────────────────────────────────────────────────────────────────────

interface ValidationTargets {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(targets: ValidationTargets) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (targets.body) {
        req.body = targets.body.parse(req.body);
      }
      if (targets.query) {
        req.query = targets.query.parse(req.query) as typeof req.query;
      }
      if (targets.params) {
        req.params = targets.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
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
      next(err);
    }
  };
}
