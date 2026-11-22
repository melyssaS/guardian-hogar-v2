/** Punto en el plano. Origen (0,0) arriba a la izquierda, eje Y hacia abajo. */
export interface Point {
    x: number;
    y: number;
}
/** Segmento recto origen → destino. */
export interface Segment {
    from: Point;
    to: Point;
}
/** Axis-Aligned Bounding Box (DD-001). */
export interface AABB {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
