import type { CollisionType } from '../geometry/collision.js';
import type { Point } from '../geometry/types.js';
import type { Zone } from './zone.js';
import type { RobotStateName } from './robot.js';

/**
 * Calidad de la lectura de posición del robot (spec 002 §2, §5).
 * RELIABLE = posición confiable; UNRELIABLE = baja confianza; MISSING = sin posición.
 */
export type PositionQuality = 'RELIABLE' | 'UNRELIABLE' | 'MISSING';

/**
 * Códigos de decisión del vigilante (spec 002 §6, catálogo de códigos).
 * Autorización, denegaciones geométricas, denegaciones por datos y rechazos por estado.
 */
export type DecisionCode =
  | 'AUTHORIZED'
  | 'ORIGIN_IN_RESTRICTED_ZONE'
  | 'RESTRICTED_ZONE_VIOLATION'
  | 'TRAJECTORY_CROSSES_ZONE'
  | 'INSUFFICIENT_DATA'
  | 'MISSING_POSITION'
  | 'ZONE_DATA_UNAVAILABLE'
  | 'SAFE_STOP_ACTIVE'
  | 'BUSY';

/**
 * Entrada de la regla pura del vigilante (spec 002 §Components and Interfaces).
 * Contiene el estado y la calidad de posición del robot, el movimiento solicitado y las
 * zonas usadas en la decisión.
 */
export interface GuardianInput {
  state: RobotStateName;
  positionQuality: PositionQuality;
  origin: Point;
  destination: Point;
  /** Zonas activas; `null` indica que el repositorio de zonas no está disponible. */
  zones: Zone[] | null;
  /** Expansión por lado; por defecto `COLLISION_PAD` (spec 001). */
  pad?: number;
}

/**
 * Decisión del vigilante para una solicitud de movimiento (spec 002 §Components and Interfaces).
 * Determinista y sin efectos secundarios: el servicio es quien persiste y registra.
 */
export interface GuardianDecision {
  code: DecisionCode;
  authorized: boolean;
  nextState: RobotStateName;
  /** Causa geométrica reutilizada de la spec 001; `null` en causas de datos o autorización. */
  collisionType: CollisionType | null;
  reason: string;
}

/**
 * Lectura de posición aportada explícitamente (spec 002 §5, sustituto de prototipo de HU-06).
 * No simula un sensor real: inyecta una lectura de forma explícita y auditable.
 */
export interface PositionReading {
  position: Point;
  /** En la línea base se admite `'RELIABLE'`. */
  quality: PositionQuality;
}
