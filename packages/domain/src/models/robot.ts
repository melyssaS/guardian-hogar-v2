import type { Point } from '../geometry/types.js';
import type { PositionQuality } from './guardian.js';

/**
 * Estados de la máquina del robot.
 * IDLE, MOVING y SAFE_STOP pertenecen a la HU-03 (spec 003 §2.1).
 * DEGRADED y RECOVERING los añade el vigilante de seguridad (spec 002 §2.1):
 * DEGRADED = operación limitada por calidad de datos insuficiente;
 * RECOVERING = salida controlada de SAFE_STOP/DEGRADED hacia IDLE.
 */
export type RobotStateName = 'IDLE' | 'MOVING' | 'SAFE_STOP' | 'DEGRADED' | 'RECOVERING';

/** Tipo de robot del catálogo (spec 003 RC-01). */
export type RobotType = 'VACUUM' | 'GUARD';

/** Última solicitud aceptada de la sesión vigente de un robot (spec 003, B-3). */
export interface LastRequest {
  sessionId: string;
  sequence: number;
  destination: Point;
  /** Marca de tiempo ISO-8601. */
  acceptedAt: string;
}

/** Robot del catálogo con su estado de seguridad actual (spec 003 RC-01). */
export interface Robot {
  id: number;
  name: string;
  type: RobotType;
  /** Marca de tiempo ISO-8601. */
  createdAt: string;
  state: RobotStateName;
  position: Point;
  positionQuality: PositionQuality;
  lastRequest: LastRequest | null;
}

/** Datos de alta de un robot; el cliente no envía estado ni posición. */
export interface RobotInput {
  name: string;
  type: RobotType;
}

/** Comando de movimiento con sesión y secuencia (spec 003 R8). */
export interface MoveCommand {
  destination: Point;
  sessionId: string;
  sequence: number;
}

/** Sesión de envío de un robot. */
export interface SessionInfo {
  sessionId: string;
}
