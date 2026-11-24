import { randomUUID } from 'node:crypto';
import type {
  LastRequest,
  MoveCommand,
  RobotId,
  RobotStateName,
  ServiceResult,
} from '@home-guardian/domain';
import { robotNotFound } from '../errors/AppError.js';
import type { AuditLogRepository } from '../repositories/auditLogRepository.js';
import type { RobotRepository } from '../repositories/robotRepository.js';
import type { SessionRepository } from '../repositories/sessionRepository.js';
import { checkSequence } from '../rules/sequenceRule.js';

/** Dependencias de las sesiones (inyección manual, SOLID-D; spec 003 DD-117, DD-132). */
export interface SessionServiceDeps {
  sessions: SessionRepository;
  audit: AuditLogRepository;
  /** Solo se usa `getStatus`: `startSession` lee el estado para auditar (002 RC-10). */
  robots: Pick<RobotRepository, 'getStatus'>;
  /** Ejecuta `fn` de forma atómica (sesión + auditoría en la misma transacción). */
  runInTransaction: <T>(fn: () => T) => T;
  /** Generador del identificador de sesión; por defecto un UUID v4 del backend. */
  newSessionId?: () => string;
}

export interface SessionService {
  /** Crea una sesión nueva, invalida la anterior del robot y audita `SESSION_STARTED`. */
  startSession(robotId: RobotId): { sessionId: string };
  /**
   * Valida sesión y secuencia de un `move` antes del vigilante. Un rechazo se devuelve como
   * resultado (sin lanzar) tras auditarlo, de modo que la transacción envolvente confirma la
   * fila (Property 16). Una aceptación consume la secuencia y registra la última solicitud.
   */
  acceptRequest(
    robotId: RobotId,
    cmd: MoveCommand,
    currentState: RobotStateName,
  ): ServiceResult<LastRequest>;
  /** Última solicitud aceptada del robot, o `null` (`GET .../state`, catálogo). */
  getLastRequest(robotId: RobotId): LastRequest | null;
}

/**
 * Sesiones y secuencia de las solicitudes de movimiento (spec 003 R8, spec 002 R11). Es el único
 * escritor de `robot_sessions`; no lee ni escribe `robot_state` (Property 12): el estado con el
 * que audita lo recibe del `move` (`currentState`) o lo lee con `robots.getStatus`.
 */
export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { sessions, audit, robots, runInTransaction } = deps;
  const newSessionId = deps.newSessionId ?? randomUUID;

  return {
    startSession(robotId) {
      return runInTransaction(() => {
        const status = robots.getStatus(robotId);
        if (!status) throw robotNotFound(robotId);
        const sessionId = newSessionId();
        sessions.replaceSession(robotId, sessionId);
        audit.record({
          robotId,
          eventCode: 'SESSION_STARTED',
          state: status.state,
          detail: { sessionId },
        });
        return { sessionId };
      });
    },

    acceptRequest(robotId, cmd, currentState) {
      return runInTransaction(() => {
        const check = checkSequence({
          currentSessionId: sessions.findSessionId(robotId),
          lastSequence: sessions.findLastSequence(robotId),
          sessionId: cmd.sessionId,
          sequence: cmd.sequence,
        });
        if (!check.ok) {
          audit.record({
            robotId,
            eventCode: check.code,
            state: currentState,
            position: cmd.destination,
            detail: { sessionId: cmd.sessionId, sequence: cmd.sequence },
          });
          return {
            kind: 'rejected',
            code: check.code,
            status: 409,
            message:
              check.code === 'INVALID_SESSION'
                ? 'Session is not the current session of this robot'
                : `Sequence ${cmd.sequence} was already processed for this session`,
          };
        }
        // R11.5: la solicitud que supera la secuencia la consume, decida lo que decida el vigilante.
        sessions.recordAccepted(robotId, cmd.sequence, cmd.destination);
        const accepted = sessions.findLastRequest(robotId);
        if (!accepted) throw new Error(`robot ${robotId} accepted request was not persisted`);
        return { kind: 'ok', value: accepted };
      });
    },

    getLastRequest(robotId) {
      return sessions.findLastRequest(robotId);
    },
  };
}
