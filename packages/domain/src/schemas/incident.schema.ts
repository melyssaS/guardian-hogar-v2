import { z } from 'zod';

/** Parámetro de ruta `:id` de GET /api/incidents/:id. */
export const incidentIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Filtro opcional de GET /api/incidents por robot. */
export const incidentListQuerySchema = z.object({
  robotId: z.coerce.number().int().positive().optional(),
});

export type IncidentListQuery = z.infer<typeof incidentListQuerySchema>;
