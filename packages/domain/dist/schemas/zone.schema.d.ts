import { z } from 'zod';
/**
 * Zod valida solo forma y tipos (DD-007). Dimensiones y límites del plano se validan en el
 * servicio para emitir INVALID_ZONE_DIMENSIONS y ZONE_OUT_OF_BOUNDS.
 */
export declare const zoneInputSchema: z.ZodObject<{
    name: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    active: z.ZodBoolean;
}, z.core.$strip>;
/** Alta: `active` es opcional y vale `true` por defecto. */
export declare const createZoneSchema: z.ZodObject<{
    name: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
    active: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
/**
 * Modificación parcial. Se deriva del esquema sin `default`: en Zod 4 un `default` dentro de
 * `.partial()` se aplica igualmente y reactivaría la zona en cada PUT.
 */
export declare const updateZoneSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    x: z.ZodOptional<z.ZodNumber>;
    y: z.ZodOptional<z.ZodNumber>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    active: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
/** Filtro de listado: sin valor → activas; `all` → todas; `false` → inactivas. */
export declare const listZoneQuerySchema: z.ZodObject<{
    active: z.ZodOptional<z.ZodEnum<{
        all: "all";
        false: "false";
    }>>;
}, z.core.$strip>;
export declare const zoneIdParamSchema: z.ZodObject<{
    id: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export type CreateZoneBody = z.infer<typeof createZoneSchema>;
export type UpdateZoneBody = z.infer<typeof updateZoneSchema>;
export type ListZoneQuery = z.infer<typeof listZoneQuerySchema>;
export type ZoneActiveFilter = NonNullable<ListZoneQuery['active']>;
