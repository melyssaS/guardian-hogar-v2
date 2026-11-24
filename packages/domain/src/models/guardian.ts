import type { CollisionType } from '../geometry/collision.js';
import type { Point } from '../geometry/types.js';
import type { Zone } from './zone.js';
import type { RobotStateName, LastRequest } from './robot.js';
import type { RuleId } from '../rules/catalog.js';

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
 * Código de un incidente: cualquier código de decisión o la pérdida de calidad de posición
 * (spec 002 RC-1a, R5.5, R5.11). Lo comparten `ruleForDecision` (spec 001) y el repositorio.
 */
export type IncidentCode = DecisionCode | 'POSITION_QUALITY_LOST';

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
  /** Zona implicada en una denegación geométrica; opcional para mantener el cambio aditivo. */
  zoneName?: string | null;
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

/** Identificador numérico de un robot del catálogo. */
export type RobotId = number;

/** Causas registradas en `state_transition_log` (spec 002 R9). */
export type TransitionCause =
  | 'AUTHORIZED'
  | 'MOVE_COMPLETED'
  | 'ORIGIN_IN_RESTRICTED_ZONE'
  | 'RESTRICTED_ZONE_VIOLATION'
  | 'TRAJECTORY_CROSSES_ZONE'
  | 'INSUFFICIENT_DATA'
  | 'MISSING_POSITION'
  | 'ZONE_DATA_UNAVAILABLE'
  | 'RECOVER_REQUESTED'
  | 'RECOVER_COMPLETED'
  | 'POSITION_QUALITY_LOST'
  | 'BOOTSTRAP_MOVING_PERSISTED'
  | 'ROBOT_REGISTERED'
  | 'MIGRATION_BASELINE';

/** Causa de rechazo de una recuperación (spec 002 R4). */
export type RecoveryRejectionCause =
  'UNRELIABLE_DATA' | 'ZONE_DATA_UNAVAILABLE' | 'UNSAFE_POSITION';

/** GET /api/robots/:robotId/state */
export interface RobotStatus {
  robotId: RobotId;
  state: RobotStateName;
  position: Point;
  positionQuality: PositionQuality;
  lastRequest: LastRequest | null;
}

/** POST /api/robots/:robotId/recover (200). */
export interface RecoverResponse extends Omit<RobotStatus, 'lastRequest'> {
  transitioned: boolean;
}

/** Incidente del vigilante: resumen de GET /api/incidents. */
export interface Incident {
  id: number;
  robotId: RobotId | null;
  robotName: string | null;
  rule: RuleId;
  zoneName: string | null;
  decisionCode: IncidentCode;
  collisionType: CollisionType | null;
  stateAfter: RobotStateName;
  origin: Point;
  destination: Point;
  reason: string;
  /** Marca de tiempo ISO-8601. */
  createdAt: string;
}

/** Detalle de GET /api/incidents/:id, con la foto de las zonas usadas en la decisión. */
export interface IncidentDetail extends Incident {
  zonesSnapshot: Zone[];
}

/** Códigos de rechazo de las operaciones del servicio (comunes a las specs 002 y 003). */
export type RejectionCode =
  | 'INVALID_SESSION'
  | 'DUPLICATE_EVENT'
  | 'SAFE_STOP_ACTIVE'
  | 'BUSY'
  | 'RECOVERY_NOT_ALLOWED'
  | 'POSITION_CONFLICT'
  | 'ROBOT_START_IN_RESTRICTED_ZONE'
  | 'ROBOT_START_NOT_VERIFIABLE';

/** Resultado tipado de las operaciones del servicio; el controller traduce `status`. */
export type ServiceResult<T> =
  | { kind: 'ok'; value: T }
  | {
      kind: 'rejected';
      code: RejectionCode;
      status: 409;
      cause?: RecoveryRejectionCause;
      message: string;
    };

/** Respuesta de `POST /api/robots/:robotId/move` (200 o 409 con decisión; spec 002 §6, R12.3). */
export type MoveResponse =
  | {
      decision: 'AUTHORIZED';
      state: RobotStateName;
      position: Point;
      robotId: RobotId;
      positionQuality: PositionQuality;
    }
  | {
      decision: 'DENIED';
      code: DecisionCode;
      state: RobotStateName;
      position: Point;
      collisionType: CollisionType | null;
      incidentId: number;
      rule: RuleId;
      zoneName: string | null;
      reason: string;
      robotId: RobotId;
      positionQuality: PositionQuality;
    }
  | {
      decision: 'REJECTED';
      code: DecisionCode;
      state: RobotStateName;
      position: Point;
      reason: string;
      robotId: RobotId;
      positionQuality: PositionQuality;
    };

/** Respuesta de `POST /api/robots/:robotId/position` (200). */
export interface PositionResponse {
  state: RobotStateName;
  position: Point;
  positionQuality: PositionQuality;
}
