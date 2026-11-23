import { z } from 'zod';

/**
 * Cuerpo de POST /api/robots (spec 003 R7). Nombre de 1 a 60 caracteres tras `trim` y tipo del
 * catálogo. `.strict()` rechaza estado o posición enviados por el cliente (422 INVALID_ROBOT).
 */
export const robotInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    type: z.enum(['VACUUM', 'GUARD']),
  })
  .strict();
