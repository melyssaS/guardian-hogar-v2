import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';

/** Traduce errores a `{ code, message }` (RNF-05). Nunca expone stack traces (RNF-04). */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }
  // JSON mal formado en el body (express.json)
  if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type: unknown }).type === 'entity.parse.failed'
  ) {
    res.status(400).json({ code: 'INVALID_JSON', message: 'Malformed JSON body' });
    return;
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
}
