import { z } from 'zod';
import { pointSchema } from './simulation.schema.js';

/**
 * Cuerpo de POST /api/robots/:robotId/move (spec 003 R8): destino, sesión (UUID) y secuencia
 * (entero >= 1). Zod valida solo forma; el orden de `sequence` lo decide `checkSequence`.
 */
export const moveCommandSchema = z.object({
  destination: pointSchema,
  sessionId: z.string().uuid(),
  sequence: z.number().int().min(1),
});
