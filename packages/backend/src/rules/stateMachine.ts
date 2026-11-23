import type { GuardianDecision, PositionQuality, RobotStateName } from '@home-guardian/domain';

/**
 * Máquina de estados del robot (spec 002 §2). Módulo puro y determinista (R7.3):
 * no realiza E/S ni persiste; solo calcula transiciones. El servicio es quien persiste.
 *
 * Codifica la tabla de transiciones permitidas de requirements §2.2 y las prohibiciones
 * P-1 (SAFE_STOP/DEGRADED → MOVING) y P-2 (datos no confiables → MOVING) de §2.3.
 */

/**
 * Tabla de transiciones permitidas por estado de origen (requirements §2.2).
 * La transición a `MOVING` queda sujeta además a P-1 y P-2 en `canTransition`.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<RobotStateName, readonly RobotStateName[]>> = {
  // IDLE: mueve+AUTHORIZED → MOVING; denegación → SAFE_STOP; datos insuficientes → DEGRADED.
  IDLE: ['MOVING', 'SAFE_STOP', 'DEGRADED'],
  // MOVING: movimiento completado → IDLE; denegación / arranque persistido → SAFE_STOP;
  //         datos insuficientes → DEGRADED. (mueve = BUSY: no cambia de estado.)
  MOVING: ['IDLE', 'SAFE_STOP', 'DEGRADED'],
  // SAFE_STOP: absorbe denegaciones y datos (self); única salida: recover → RECOVERING.
  SAFE_STOP: ['SAFE_STOP', 'RECOVERING'],
  // DEGRADED: denegación → SAFE_STOP; datos insuficientes (self); recover → RECOVERING.
  DEGRADED: ['SAFE_STOP', 'DEGRADED', 'RECOVERING'],
  // RECOVERING: denegación → SAFE_STOP; datos insuficientes → DEGRADED; recover → IDLE.
  RECOVERING: ['SAFE_STOP', 'DEGRADED', 'IDLE'],
};

/**
 * ¿Es legal la transición `from → to` dada la calidad de posición actual?
 *
 * Aplica la tabla de §2.2 y las dos invariantes de seguridad de §2.3:
 * - **P-1:** `SAFE_STOP → MOVING` y `DEGRADED → MOVING` están prohibidos; la única salida
 *   de parada hacia `MOVING` pasa por `RECOVERING → IDLE`.
 * - **P-2:** cualquier transición a `MOVING` exige `positionQuality === 'RELIABLE'`.
 *
 * @param from Estado de origen.
 * @param to Estado de destino propuesto.
 * @param positionQuality Calidad de la posición del robot.
 * @returns `true` si la transición está permitida; `false` en caso contrario.
 */
export function canTransition(
  from: RobotStateName,
  to: RobotStateName,
  positionQuality: PositionQuality,
): boolean {
  if (to === 'MOVING') {
    // P-2: sin datos confiables no se permite ninguna transición a MOVING.
    if (positionQuality !== 'RELIABLE') {
      return false;
    }
    // P-1: SAFE_STOP y DEGRADED no pueden ir directamente a MOVING.
    if (from === 'SAFE_STOP' || from === 'DEGRADED') {
      return false;
    }
  }
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Deriva el estado persistido a partir de una decisión del vigilante (spec 002 §3/§4).
 *
 * `decision.nextState` es el estado propuesto por la regla pura; esta función es el punto
 * donde la máquina de estados impone su legalidad. Es pura: no muta la decisión ni persiste.
 * El servicio llama a `applyDecision` y, en un `AUTHORIZED`, encadena `completeMove`.
 *
 * @param _current Estado actual del robot (contexto; la legalidad la fija la regla y P-1/P-2).
 * @param decision Decisión producida por `evaluateMovement`.
 * @returns El estado resultante.
 */
export function applyDecision(
  _current: RobotStateName,
  decision: GuardianDecision,
): RobotStateName {
  return decision.nextState;
}

/**
 * Completa un movimiento transitorio: `MOVING → IDLE` (spec 002 §2.2, DD-209).
 *
 * En el prototipo síncrono el movimiento autorizado se completa de inmediato dentro de la
 * misma solicitud, por lo que el estado persistido final es `IDLE`. Para cualquier estado
 * distinto de `MOVING` se devuelve el estado sin cambios (sin efecto).
 *
 * @param current Estado actual del robot.
 * @returns `IDLE` si el estado era `MOVING`; el mismo estado en caso contrario.
 */
export function completeMove(current: RobotStateName): RobotStateName {
  return current === 'MOVING' ? 'IDLE' : current;
}
