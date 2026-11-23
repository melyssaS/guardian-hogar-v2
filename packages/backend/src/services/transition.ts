import type {
  Point,
  PositionQuality,
  RobotId,
  RobotStateName,
  TransitionCause,
} from '@home-guardian/domain';
import type { RobotRepository } from '../repositories/robotRepository.js';
import type { TransitionLogRepository } from '../repositories/transitionLogRepository.js';
import { canTransition } from '../rules/stateMachine.js';

/** Transición persistible (spec 002 §3, T1–T9). */
export interface TransitionRequest {
  robotId: RobotId;
  from: RobotStateName;
  to: RobotStateName;
  cause: TransitionCause;
  /** Posición que queda persistida junto con el nuevo estado. */
  position: Point;
  /** Calidad vigente; la exige `canTransition` (P-2). */
  positionQuality: PositionQuality;
  /** Datos opcionales de la transición (destino, incidente, snapshot de zonas…). */
  detail?: Record<string, unknown>;
}

export type TransitionFn = (request: TransitionRequest) => void;

/**
 * Helper `transition` (spec 002 §3): (1) comprueba `canTransition`, (2) escribe `robot_state` y
 * (3) inserta en `state_transition_log`. No abre transacción: corre dentro de la del llamador,
 * de modo que un fallo en cualquier paso revierte los tres. Una pareja fuera de la lista blanca
 * es un error de programación y lanza.
 */
export function createTransition(deps: {
  robots: RobotRepository;
  transitions: TransitionLogRepository;
}): TransitionFn {
  const { robots, transitions } = deps;
  return ({ robotId, from, to, cause, position, positionQuality, detail }) => {
    if (!canTransition(from, to, positionQuality)) {
      throw new Error(`Illegal transition ${from} -> ${to} for robot ${robotId} (${cause})`);
    }
    robots.saveState(robotId, to, position);
    transitions.append({ robotId, fromState: from, toState: to, cause, detail });
  };
}
