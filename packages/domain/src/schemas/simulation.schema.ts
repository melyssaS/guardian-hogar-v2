import { z } from 'zod';

/**
 * Zod valida solo forma y tipos (RNF-01). Los límites del plano se validan en el servicio
 * para emitir DESTINATION_OUT_OF_BOUNDS (DD-107). `z.number()` ya rechaza NaN e Infinity.
 */
export const pointSchema = z.object({ x: z.number(), y: z.number() });

/** Cuerpo de POST /api/simulation/move. El cliente no envía el origen (RF-02.1). */
export const moveRequestSchema = z.object({ destination: pointSchema });

export type MoveRequestBody = z.infer<typeof moveRequestSchema>;
