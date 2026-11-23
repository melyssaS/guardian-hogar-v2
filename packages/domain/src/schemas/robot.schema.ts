import { z } from 'zod';
import { pointSchema, moveRequestSchema } from './simulation.schema.js';

/**
 * Cuerpo de POST /api/robot/move (spec 002 §6). El cliente solo envía el destino; el origen
 * es la posición persistida del robot. Reutiliza `moveRequestSchema` de la spec 003 (misma
 * forma `{ destination: {x,y} }`) para no duplicar la validación del punto (DD-208, DRY).
 */
export const moveSchema = moveRequestSchema;

/**
 * Cuerpo de POST /api/robot/position (spec 002 §5b, R8). Aporte explícito de una lectura de
 * posición. Zod valida solo forma y tipos (R7.1): `position` reutiliza `pointSchema` (los
 * límites del plano los valida el servicio, DD-107) y `quality` es el enum de `PositionQuality`.
 * Se admiten los tres valores; la semántica (línea base `RELIABLE`; `MISSING`/`UNRELIABLE` como
 * señal de pérdida, ADR-10/R6.2) la decide el servicio.
 */
export const positionSchema = z.object({
  position: pointSchema,
  quality: z.enum(['RELIABLE', 'UNRELIABLE', 'MISSING']),
});

/** Parámetro de ruta `:robotId` (entero positivo; la existencia la decide el servicio). */
export const robotIdParamSchema = z.object({
  robotId: z.coerce.number().int().positive(),
});

export type MoveBody = z.infer<typeof moveSchema>;
export type PositionBody = z.infer<typeof positionSchema>;
