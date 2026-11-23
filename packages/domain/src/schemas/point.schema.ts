import { z } from 'zod';

/**
 * Punto del plano. Zod valida solo forma y tipos (RNF-01); los límites del plano se validan en el
 * servicio para emitir DESTINATION_OUT_OF_BOUNDS (DD-107). `z.number()` ya rechaza NaN e Infinity.
 * Lo reutilizan `moveCommandSchema` y `positionSchema`.
 */
export const pointSchema = z.object({ x: z.number(), y: z.number() });
