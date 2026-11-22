import type { ZoneRect } from '../models/zone.js';
import type { AABB, Point } from './types.js';
/** Expansión conservadora (DD-001): amplía la zona `pad = r + m` por cada lado. */
export declare function expandZone(z: ZoneRect, pad: number): AABB;
/** Punto dentro de la caja con borde inclusivo (DD-003): el borde pertenece a la zona. */
export declare function pointInAABB(p: Point, b: AABB): boolean;
