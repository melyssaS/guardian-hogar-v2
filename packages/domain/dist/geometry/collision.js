import { expandZone, pointInAABB } from './aabb.js';
import { COLLISION_PAD } from './constants.js';
/**
 * Liang-Barsky (DD-002): indica si el segmento toca la caja, con borde inclusivo.
 * Un segmento degenerado (origen == destino) se reduce a `pointInAABB`, sin dividir por cero.
 */
export function segmentIntersectsAABB(s, b) {
    const dx = s.to.x - s.from.x;
    const dy = s.to.y - s.from.y;
    if (dx === 0 && dy === 0)
        return pointInAABB(s.from, b);
    const p = [-dx, dx, -dy, dy];
    const q = [s.from.x - b.minX, b.maxX - s.from.x, s.from.y - b.minY, b.maxY - s.from.y];
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < 4; i++) {
        const pi = p[i];
        const qi = q[i];
        if (pi === 0) {
            // Paralelo a este par de bordes: fuera si está al otro lado.
            if (qi < 0)
                return false;
            continue;
        }
        const r = qi / pi;
        if (pi < 0) {
            if (r > t1)
                return false;
            if (r > t0)
                t0 = r;
        }
        else {
            if (r < t0)
                return false;
            if (r < t1)
                t1 = r;
        }
    }
    return t0 <= t1;
}
/**
 * Evalúa un movimiento contra una zona expandida `pad` por lado.
 * Prioridad del tipo: origen dentro > destino dentro > trayectoria interseca.
 * `pad` por defecto es `COLLISION_PAD` (r + m del entorno); las pruebas lo fijan explícitamente.
 */
export function isCollision(zone, s, pad = COLLISION_PAD) {
    const box = expandZone(zone, pad);
    if (pointInAABB(s.from, box))
        return { collides: true, type: 'ORIGIN_IN_RESTRICTED_ZONE' };
    if (pointInAABB(s.to, box))
        return { collides: true, type: 'RESTRICTED_ZONE_VIOLATION' };
    if (segmentIntersectsAABB(s, box))
        return { collides: true, type: 'TRAJECTORY_CROSSES_ZONE' };
    return { collides: false, type: null };
}
