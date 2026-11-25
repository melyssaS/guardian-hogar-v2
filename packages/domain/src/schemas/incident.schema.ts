import { z } from 'zod';

/** Parámetro de ruta `:id` de GET /api/incidents/:id. */
export const incidentIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Severidad de un incidente (spec 006, HU-06): solo estos cuatro valores, en mayúsculas. */
export const severitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * Filtros opcionales de GET /api/incidents. `robotId` va primero a propósito: si ambos son inválidos,
 * el primer problema es el de `robotId` y conserva su error (spec 006 DD-604).
 */
export const incidentListQuerySchema = z.object({
  robotId: z.coerce.number().int().positive().optional(),
  severity: severitySchema.optional(),
});

export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;
