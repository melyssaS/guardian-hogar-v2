import type { ZoneRect } from '../models/zone.js';
import type { AABB, Point } from './types.js';

/** Expansión conservadora (DD-001): amplía la zona `pad = r + m` por cada lado. */
export function expandZone(z: ZoneRect, pad: number): AABB {
  return {
    minX: z.x - pad,
    minY: z.y - pad,
    maxX: z.x + z.width + pad,
    maxY: z.y + z.height + pad,
  };
}

/** Punto dentro de la caja con borde inclusivo (DD-003): el borde pertenece a la zona. */
export function pointInAABB(p: Point, b: AABB): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}
