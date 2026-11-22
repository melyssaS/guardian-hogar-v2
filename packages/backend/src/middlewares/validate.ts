import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { validationError } from '../errors/AppError.js';

type Source = 'body' | 'query' | 'params';

/** Valida y sanea `req[source]` con Zod; si falla, responde 422 VALIDATION_ERROR (RNF-01). */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.') || source}: ${i.message}`)
        .join('; ');
      next(validationError(message));
      return;
    }
    // req.query es un getter en Express 5; aquí (Express 4) se puede reasignar.
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}
