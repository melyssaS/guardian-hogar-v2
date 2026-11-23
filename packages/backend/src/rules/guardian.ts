import {
  COLLISION_PAD,
  expandZone,
  isCollision,
  pointInAABB,
  type CollisionType,
  type DecisionCode,
  type GuardianDecision,
  type GuardianInput,
  type PositionQuality,
  type Point,
  type RecoveryRejectionCause,
  type RobotStateName,
  type Zone,
} from '@home-guardian/domain';

/** Estados que no admiten iniciar un movimiento; rechazan antes de evaluar geometría (R2.1). */
const NON_MOVING_STATES: readonly RobotStateName[] = ['SAFE_STOP', 'DEGRADED', 'RECOVERING'];

/**
 * Prioridad global de las colisiones entre todas las zonas activas (R1.7, R2.5):
 * origen > destino > trayectoria. El índice menor gana.
 */
const COLLISION_PRIORITY: readonly CollisionType[] = [
  'ORIGIN_IN_RESTRICTED_ZONE',
  'RESTRICTED_ZONE_VIOLATION',
  'TRAJECTORY_CROSSES_ZONE',
];

/** Texto legible por rama de decisión (consistente con `watchmanRule`). */
const REASON_BY_CODE: Record<DecisionCode, string> = {
  AUTHORIZED: 'Destination and trajectory are clear',
  ORIGIN_IN_RESTRICTED_ZONE: 'Origin is inside restricted zone',
  RESTRICTED_ZONE_VIOLATION: 'Destination is inside restricted zone',
  TRAJECTORY_CROSSES_ZONE: 'Trajectory crosses restricted zone',
  INSUFFICIENT_DATA: 'Position quality is unreliable; movement denied',
  MISSING_POSITION: 'Position is missing; movement denied',
  ZONE_DATA_UNAVAILABLE: 'Zone data is unavailable; movement denied',
  SAFE_STOP_ACTIVE: 'Robot is not in a movable state; movement rejected',
  BUSY: 'A movement is already in progress; movement rejected',
};

/** Construye la decisión fijando el `reason` a partir del catálogo. */
function decision(
  code: DecisionCode,
  authorized: boolean,
  nextState: RobotStateName,
  collisionType: CollisionType | null,
  zoneName?: string,
): GuardianDecision {
  const base = { code, authorized, nextState, collisionType, reason: REASON_BY_CODE[code] };
  // `zoneName` solo existe en las denegaciones geométricas (R5.5); en el resto se omite.
  return zoneName === undefined ? base : { ...base, zoneName };
}

/**
 * Regla pura del vigilante de seguridad (spec 002 §2, §3; HU-04, HU-05).
 *
 * Evalúa en ORDEN ESTRICTO y se detiene en la primera condición que aplique (R2.5):
 *   1. Estado no admite movimiento: SAFE_STOP/DEGRADED/RECOVERING → `SAFE_STOP_ACTIVE`
 *      (rechazo, `nextState` = estado actual, sin incidente); `MOVING` ocupado → `BUSY`.
 *   2. `positionQuality === 'UNRELIABLE'` → `INSUFFICIENT_DATA` (`nextState` DEGRADED).
 *   3. `positionQuality === 'MISSING'`    → `MISSING_POSITION`  (`nextState` DEGRADED).
 *   4. `zones === null` (repositorio caído) → `ZONE_DATA_UNAVAILABLE` (`nextState` SAFE_STOP).
 *   5-7. Geometría reutilizando `isCollision` de la spec 001 (R1.6; sin recálculo): se evalúan
 *        todas las zonas activas y se elige la colisión de mayor prioridad global
 *        origen > destino > trayectoria (R1.7) → `nextState` SAFE_STOP.
 *   8. Nada aplica → `AUTHORIZED` (`authorized` true, `nextState` MOVING transitorio).
 *
 * Pura y determinista (R7.3, Property 8): la salida depende solo de las entradas; no persiste,
 * no registra ni muta sus argumentos. Ejecutable sin frontend ni base de datos real (T-12).
 */
export function evaluateMovement(input: GuardianInput): GuardianDecision {
  const { state, positionQuality, origin, destination, zones, pad } = input;

  // 1. Estado del robot.
  if (NON_MOVING_STATES.includes(state)) {
    return decision('SAFE_STOP_ACTIVE', false, state, null);
  }
  if (state === 'MOVING') {
    return decision('BUSY', false, 'MOVING', null);
  }

  // 2-3. Calidad de posición, antes que cualquier geometría (fallo seguro por datos).
  if (positionQuality === 'UNRELIABLE') {
    return decision('INSUFFICIENT_DATA', false, 'DEGRADED', null);
  }
  if (positionQuality === 'MISSING') {
    return decision('MISSING_POSITION', false, 'DEGRADED', null);
  }

  // 4. Fallo del repositorio de zonas.
  if (zones === null) {
    return decision('ZONE_DATA_UNAVAILABLE', false, 'SAFE_STOP', null);
  }

  // 5-7. Geometría: colisión de mayor prioridad global entre todas las zonas activas.
  const segment = { from: origin, to: destination };
  let best: CollisionType | null = null;
  let bestZone: Zone | null = null;
  for (const zone of zones) {
    if (!isActive(zone)) continue;
    const { type } = isCollision(zone, segment, pad);
    if (type !== null && outranks(type, best)) {
      best = type;
      bestZone = zone;
      // Origen es la prioridad máxima: no puede ser superado, corta temprano.
      if (best === 'ORIGIN_IN_RESTRICTED_ZONE') break;
    }
  }
  if (best !== null && bestZone !== null) {
    return decision(best, false, 'SAFE_STOP', best, bestZone.name);
  }

  // 8. Autorizado.
  return decision('AUTHORIZED', true, 'MOVING', null);
}

/** Guarda defensiva: solo se evalúan zonas activas (coincide con `watchmanRule`). */
function isActive(zone: Zone): boolean {
  return zone.active !== false;
}

/** `true` si `candidate` tiene prioridad estricta sobre la mejor colisión hallada. */
function outranks(candidate: CollisionType, current: CollisionType | null): boolean {
  if (current === null) return true;
  return COLLISION_PRIORITY.indexOf(candidate) < COLLISION_PRIORITY.indexOf(current);
}

/** Resultado de `evaluateRecovery`: permitida o rechazada con su causa (R4.4). */
export type RecoveryEvaluation =
  { allowed: true } | { allowed: false; cause: RecoveryRejectionCause };

/**
 * Regla pura de recuperación (spec 002 R4.4). Orden estricto, se detiene en el primer fallo:
 * calidad distinta de `RELIABLE` → `UNRELIABLE_DATA`; zonas no disponibles (`null`) →
 * `ZONE_DATA_UNAVAILABLE`; posición dentro de una zona ACTIVA expandida por `pad` →
 * `UNSAFE_POSITION`. Las zonas con `active === false` se ignoran (defensa en profundidad).
 */
export function evaluateRecovery(input: {
  positionQuality: PositionQuality;
  position: Point;
  zones: Zone[] | null;
  pad?: number;
}): RecoveryEvaluation {
  const { positionQuality, position, zones, pad } = input;
  if (positionQuality !== 'RELIABLE') return { allowed: false, cause: 'UNRELIABLE_DATA' };
  if (zones === null) return { allowed: false, cause: 'ZONE_DATA_UNAVAILABLE' };
  if (isInsideActiveZone(position, zones, pad)) return { allowed: false, cause: 'UNSAFE_POSITION' };
  return { allowed: true };
}

/** Resultado de `evaluateStartPosition` (R12.2). */
export type StartPositionEvaluation =
  | { allowed: true }
  | { allowed: false; reason: 'ROBOT_START_IN_RESTRICTED_ZONE' | 'ZONE_DATA_UNAVAILABLE' };

/**
 * Regla pura de la posición de alta de un robot (spec 002 R12.2). Dentro de una zona activa
 * expandida por `pad` → `ROBOT_START_IN_RESTRICTED_ZONE`; zonas no disponibles (`null`) →
 * rechazo con razón `ZONE_DATA_UNAVAILABLE` (el servicio lo traduce a
 * `ROBOT_START_NOT_VERIFIABLE`). Las zonas inactivas se ignoran.
 */
export function evaluateStartPosition(input: {
  position: Point;
  zones: Zone[] | null;
  pad?: number;
}): StartPositionEvaluation {
  const { position, zones, pad } = input;
  if (zones === null) return { allowed: false, reason: 'ZONE_DATA_UNAVAILABLE' };
  if (isInsideActiveZone(position, zones, pad)) {
    return { allowed: false, reason: 'ROBOT_START_IN_RESTRICTED_ZONE' };
  }
  return { allowed: true };
}

/** `true` si el punto cae dentro de alguna zona activa expandida por `pad`. */
function isInsideActiveZone(point: Point, zones: Zone[], pad: number = COLLISION_PAD): boolean {
  return zones.some((zone) => isActive(zone) && pointInAABB(point, expandZone(zone, pad)));
}
