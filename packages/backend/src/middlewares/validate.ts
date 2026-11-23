import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { type AppError, validationError } from '../errors/AppError.js';

type Source = 'body' | 'query' | 'params';

/**
 * Valida y sanea `req[source]` con Zod (RNF-01). Si falla, responde con el error de
 * `toError`: por defecto 422 VALIDATION_ERROR; /api/simulation usa INVALID_DESTINATION.
 */
export function validate(
  schema: ZodTypeAny,
  source: Source = 'body',
  toError: (message: string) => AppError = validationError,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.') || source}: ${i.message}`)
        .join('; ');
      next(toError(message));
      return;
    }
    // req.query es un getter en Express 5; aquí (Express 4) se puede reasignar.
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}
