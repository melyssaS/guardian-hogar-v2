import type { ZoneRect } from '../models/zone.js';
import type { AABB, Segment } from './types.js';
/**
 * Liang-Barsky (DD-002): indica si el segmento toca la caja, con borde inclusivo.
 * Un segmento degenerado (origen == destino) se reduce a `pointInAABB`, sin dividir por cero.
 */
export declare function segmentIntersectsAABB(s: Segment, b: AABB): boolean;
/** Causa de la colisión; la spec 002 la usa como código de decisión (DD-009). */
export type CollisionType = 'ORIGIN_IN_RESTRICTED_ZONE' | 'RESTRICTED_ZONE_VIOLATION' | 'TRAJECTORY_CROSSES_ZONE';
export interface CollisionResult {
    collides: boolean;
    /** `null` cuando no hay colisión. */
    type: CollisionType | null;
}
/**
 * Evalúa un movimiento contra una zona expandida `pad` por lado.
 * Prioridad del tipo: origen dentro > destino dentro > trayectoria interseca.
 * `pad` por defecto es `COLLISION_PAD` (r + m del entorno); las pruebas lo fijan explícitamente.
 */
export declare function isCollision(zone: ZoneRect, s: Segment, pad?: number): CollisionResult;
