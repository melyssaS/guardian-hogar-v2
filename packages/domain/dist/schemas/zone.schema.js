import { z } from 'zod';
/**
 * Zod valida solo forma y tipos (DD-007). Dimensiones y límites del plano se validan en el
 * servicio para emitir INVALID_ZONE_DIMENSIONS y ZONE_OUT_OF_BOUNDS.
 */
export const zoneInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    active: z.boolean(),
});
/** Alta: `active` es opcional y vale `true` por defecto. */
export const createZoneSchema = zoneInputSchema.extend({ active: z.boolean().default(true) });
/**
 * Modificación parcial. Se deriva del esquema sin `default`: en Zod 4 un `default` dentro de
 * `.partial()` se aplica igualmente y reactivaría la zona en cada PUT.
 */
export const updateZoneSchema = zoneInputSchema.partial();
/** Filtro de listado: sin valor → activas; `all` → todas; `false` → inactivas. */
export const listZoneQuerySchema = z.object({
    active: z.enum(['all', 'false']).optional(),
});
export const zoneIdParamSchema = z.object({
    id: z.coerce.number().int().positive(),
});
