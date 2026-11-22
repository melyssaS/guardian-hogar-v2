/** Dimensiones del plano (modelo geométrico, RF-01.1). */
export const FLOOR_WIDTH = 1000;
export const FLOOR_HEIGHT = 800;
// El paquete se usa también en el navegador, donde `process` no existe.
function readEnv(name) {
    return typeof process === 'undefined' ? undefined : process.env[name];
}
/** Lee un número de una variable de entorno; si falta o no es finito, devuelve `fallback`. */
export function envNumber(name, fallback) {
    const raw = readEnv(name);
    if (raw === undefined || raw.trim() === '')
        return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}
/** r — radio del robot. Variable de entorno `ROBOT_RADIUS`, por defecto 0 (DD-008). */
export const ROBOT_RADIUS = envNumber('ROBOT_RADIUS', 0);
/** m — margen de seguridad. Variable de entorno `SAFETY_MARGIN`, por defecto 0 (DD-008). */
export const SAFETY_MARGIN = envNumber('SAFETY_MARGIN', 0);
/** Pad total r + m aplicado por lado a cada zona antes de evaluar colisión. */
export const COLLISION_PAD = ROBOT_RADIUS + SAFETY_MARGIN;
