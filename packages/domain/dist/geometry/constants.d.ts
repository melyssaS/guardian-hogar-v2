/** Dimensiones del plano (modelo geométrico, RF-01.1). */
export declare const FLOOR_WIDTH = 1000;
export declare const FLOOR_HEIGHT = 800;
/** Lee un número de una variable de entorno; si falta o no es finito, devuelve `fallback`. */
export declare function envNumber(name: string, fallback: number): number;
/** r — radio del robot. Variable de entorno `ROBOT_RADIUS`, por defecto 0 (DD-008). */
export declare const ROBOT_RADIUS: number;
/** m — margen de seguridad. Variable de entorno `SAFETY_MARGIN`, por defecto 0 (DD-008). */
export declare const SAFETY_MARGIN: number;
/** Pad total r + m aplicado por lado a cada zona antes de evaluar colisión. */
export declare const COLLISION_PAD: number;
