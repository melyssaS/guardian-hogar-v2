import type { CollisionType } from '../geometry/collision.js';
import type { Point } from '../geometry/types.js';

/**
 * Estados del robot en alcance de la HU-03 (spec 003 §2.1).
 * DEGRADED y RECOVERING quedan fuera: dependen de sensores (reservado).
 */
export type RobotStateName = 'IDLE' | 'MOVING' | 'SAFE_STOP';

/** Decisión del vigilante (spec 003 §2.2). */
export type Decision = 'ALLOW' | 'PREVENTIVE_STOP' | 'DENIED_SAFE_STOP';

/** Estado y posición actuales del robot; el backend es la fuente de verdad (DD-103). */
export interface RobotSnapshot {
  state: RobotStateName;
  position: Point;
}

/** Solicitud de movimiento. El origen es la posición del robot en el servidor (RF-02.1). */
export interface MoveRequest {
  destination: Point;
}

/** Respuesta del vigilante a una solicitud de movimiento (RF-02.2, RF-03). */
export interface MoveResult {
  decision: Decision;
  state: RobotStateName;
  /** Nueva posición (ALLOW) u origen (parada o denegación). */
  position: Point;
  /** Solo en PREVENTIVE_STOP. */
  collisionType?: CollisionType;
  /** Zona implicada, si aplica. */
  zoneName?: string;
  /** Solo en DENIED_SAFE_STOP. */
  code?: 'SAFE_STOP_ACTIVE';
  reason: string;
}
