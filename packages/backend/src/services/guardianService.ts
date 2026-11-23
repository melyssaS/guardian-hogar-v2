import type {
  CollisionType,
  DecisionCode,
  LastRequest,
  MoveCommand,
  Point,
  PositionQuality,
  PositionReading,
  RecoverResponse,
  RecoveryRejectionCause,
  RobotId,
  RobotStateName,
  RobotStatus,
  RobotType,
  RuleId,
  ServiceResult,
  Zone,
} from '@home-guardian/domain';
import { ruleForDecision } from '@home-guardian/domain';
import { robotNotFound } from '../errors/AppError.js';
import type { AuditLogRepository } from '../repositories/auditLogRepository.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';
import type { RobotRepository, RobotStateRecord } from '../repositories/robotRepository.js';
import type { TransitionLogRepository } from '../repositories/transitionLogRepository.js';
import { evaluateMovement, evaluateRecovery, evaluateStartPosition } from '../rules/guardian.js';
import { applyDecision, completeMove } from '../rules/stateMachine.js';
import { assertDestinationWithinFloor, assertPositionWithinFloor } from './floorBounds.js';
import type { SessionService } from './sessionService.js';
import { createTransition } from './transition.js';

/**
 * Dependencias del vigilante (SOLID-D, inyección manual; design §4). El servicio no instancia
 * repositorios ni conoce Express: solo orquesta la regla pura y persiste el resultado.
 */
export interface GuardianServiceDeps {
  robots: RobotRepository;
  /** Incidentes inmutables para denegaciones que paran (R5.2, DD-205). */
  incidents: IncidentRepository;
  /** Log de auditoría para rechazos por estado (R5.3). */
  audit: AuditLogRepository;
  /** Registro append-only de transiciones de estado (R9). */
  transitions: TransitionLogRepository;
  /**
   * Sesión y secuencia de las solicitudes de `move` (spec 003): `acceptRequest` valida y audita
   * los rechazos y registra la última solicitud; `getLastRequest` alimenta `RobotStatus`.
   */
  sessions: Pick<SessionService, 'acceptRequest' | 'getLastRequest'>;
  /**
   * Zonas activas vigentes en el momento de la evaluación. Si lanza, el servicio lo captura y
   * evalúa con `zones = null` → `ZONE_DATA_UNAVAILABLE` (fallo seguro, DD-204).
   */
  getActiveZones: () => Zone[];
  /** Ejecuta `fn` de forma atómica (estado + registro en la misma transacción). */
  runInTransaction: <T>(fn: () => T) => T;
  /** Pad r + m; por defecto el de la regla (COLLISION_PAD). */
  pad?: number;
}

/** Códigos de denegación que llevan a parada preventiva y, por tanto, crean incidente (R5.2). */
const STOPPING_DENIALS = [
  'ORIGIN_IN_RESTRICTED_ZONE',
  'RESTRICTED_ZONE_VIOLATION',
  'TRAJECTORY_CROSSES_ZONE',
  'INSUFFICIENT_DATA',
  'MISSING_POSITION',
  'ZONE_DATA_UNAVAILABLE',
] as const satisfies readonly DecisionCode[];

type StoppingDenial = (typeof STOPPING_DENIALS)[number];

function isStoppingDenial(code: DecisionCode): code is StoppingDenial {
  return (STOPPING_DENIALS as readonly DecisionCode[]).includes(code);
}

/** Resultado de `move` cuando el movimiento se autoriza (200; design "Mapeo decisión → HTTP"). */
export interface MoveAuthorized {
  decision: 'AUTHORIZED';
  state: RobotStateName;
  position: Point;
}

/** Resultado de `move` cuando se deniega y para (200 con la decisión en el cuerpo, DD-203). */
export interface MoveDenied {
  decision: 'DENIED';
  code: DecisionCode;
  state: RobotStateName;
  position: Point;
  collisionType: CollisionType | null;
  incidentId: number;
  /** Regla incumplida del catálogo `RULES` (spec 001), la misma que guarda el incidente. */
  rule: RuleId;
  /** Zona implicada en la denegación geométrica; `null` en causas de datos. */
  zoneName: string | null;
  reason: string;
}

/** Resultado de `move` cuando se rechaza por estado (409, DD-203). */
export interface MoveRejected {
  decision: 'REJECTED';
  code: DecisionCode;
  state: RobotStateName;
  position: Point;
  reason: string;
}

/** Unión discriminada por `decision`; el controller la mapea a HTTP (task 13). */
export type MoveOutcome = MoveAuthorized | MoveDenied | MoveRejected;

/** Respuesta de `POST /api/robots/:robotId/move`: la decisión más el robot y su calidad (R12.3). */
export type PerRobotMoveOutcome = MoveOutcome & {
  robotId: RobotId;
  positionQuality: PositionQuality;
};

/** Rechazo previo al vigilante por sesión inválida o secuencia duplicada (R11.3, R11.4). */
export type MoveSessionRejection = Extract<ServiceResult<LastRequest>, { kind: 'rejected' }>;

/**
 * Resultado de `recover` (design §4, R4.4-R4.5): `ok` con `transitioned` (true si salió de la
 * parada, false si ya estaba en `IDLE`) o `rejected` 409 `RECOVERY_NOT_ALLOWED` con su `cause`.
 */
export type RecoverOutcome = ServiceResult<RecoverResponse>;

/** Texto del rechazo de `recover` por causa (R4.4). */
const RECOVERY_REASON: Record<RecoveryRejectionCause, string> = {
  UNRELIABLE_DATA: 'Position quality is not reliable; cannot recover',
  ZONE_DATA_UNAVAILABLE: 'Zone data is unavailable; cannot confirm a safe position',
  UNSAFE_POSITION: 'Current position is inside a restricted zone; cannot recover',
};

/** Resultado de aceptar una lectura de posición (200, design §5b). */
export interface PositionOutcome {
  state: RobotStateName;
  position: Point;
  positionQuality: PositionQuality;
}

export interface GuardianService {
  /** Estado, posición y calidad de posición actuales del robot. */
  getState(robotId: RobotId): PositionOutcome;
  /** Estado completo por robot, con la última solicitud aceptada (`GET .../state`, R12.3). */
  getStatus(robotId: RobotId): RobotStatus;
  /**
   * Evalúa y (si procede) autoriza un movimiento del robot (R11.5): robot existe (404) → límites
   * del plano (422) → sesión y secuencia (`acceptRequest`, 409) → vigilante. La solicitud que
   * supera la secuencia la consume, decida lo que decida el vigilante.
   */
  move(robotId: RobotId, cmd: MoveCommand): PerRobotMoveOutcome | MoveSessionRejection;
  /**
   * Vía TEMPORAL sin sesión ni secuencia para el controller antiguo de `/api/robot/move`
   * (decisión 2, desvío declarado de R11): mismo vigilante, sin `acceptRequest`. Solo la usan
   * `robotController` (handler legacy) y sus pruebas; RC-20 la retira (R10.7).
   */
  moveLegacy(robotId: RobotId, destination: Point): MoveOutcome;
  /** Recuperación explícita y validada (R4); un rechazo es un resultado, no una excepción. */
  recover(robotId: RobotId): RecoverOutcome;
  /**
   * Aporta una lectura de posición (R8). Nunca relocaliza: `RELIABLE` solo se acepta si coincide
   * con la posición actual (si no, `POSITION_CONFLICT`); `UNRELIABLE`/`MISSING` es una señal de
   * pérdida que fija la calidad y, desde `IDLE`, lleva a `DEGRADED` con un incidente (R3.6, R5.11).
   */
  setPosition(robotId: RobotId, reading: PositionReading): ServiceResult<PositionOutcome>;
  /**
   * Alta de un robot, paso 1 (R12.2): decide si la posición de inicio es segura. Si no, audita
   * `ROBOT_START_IN_RESTRICTED_ZONE` / `ROBOT_START_NOT_VERIFIABLE` con `robot_id` y `state`
   * nulos y devuelve `rejected` (el catálogo no inserta nada y confirma la transacción).
   */
  checkStartPosition(
    position: Point,
    robot: { name: string; type: RobotType },
  ): ServiceResult<void>;
  /**
   * Alta de un robot, paso 2 (R12.2, R9.5): `INSERT` simple del estado inicial (`IDLE`,
   * `RELIABLE`) y T9 `ROBOT_REGISTERED`. Lanza (y la transacción se revierte) si el robot ya
   * tiene estado o la posición no es verificablemente segura: es un error del llamador.
   */
  initRobot(robotId: RobotId, position: Point): void;
}

/**
 * Vigilante de seguridad (HU-04, HU-05; design §4, §5, §5b).
 *
 * Orquesta la regla pura `evaluateMovement` y la máquina de estados, y persiste el resultado:
 *  - AUTHORIZED → actualiza la posición al destino y persiste `IDLE` (MOVING es transitorio y
 *    se completa en la misma solicitud, DD-209): el siguiente movimiento no se rechaza con
 *    `BUSY` (Property 9, R1.5).
 *  - Denegación que para → persiste `SAFE_STOP`/`DEGRADED` conservando la posición (R3.3) y
 *    crea un incidente inmutable con el snapshot de zonas (R5.2, Property 6).
 *  - Rechazo por estado (`SAFE_STOP_ACTIVE`/`BUSY`) → sin cambios de estado ni posición (R3.3);
 *    se registra en el log de auditoría, no como incidente (R5.3, Property 6).
 *
 * Registro de evaluaciones (R5.1): la denegación queda en `incidents` (con `zones_snapshot` y
 * `collisionType`/causa) y el rechazo por estado en `audit_log`. Un AUTHORIZED queda registrado
 * por el propio cambio de estado/posición persistido; no se duplica en `movement_log`, cuya
 * forma pertenece a la spec 003. Así cada evaluación auditable queda trazada sin duplicar logs.
 */
export function createGuardianService(deps: GuardianServiceDeps): GuardianService {
  const { robots, incidents, audit, transitions, sessions, getActiveZones, runInTransaction, pad } =
    deps;
  const transition = createTransition({ robots, transitions });

  /** Carga las zonas activas; si el repositorio falla, devuelve `null` (fallo seguro, DD-204). */
  function loadZones(): Zone[] | null {
    try {
      return getActiveZones();
    } catch {
      return null;
    }
  }

  /** Estado del robot; `404 ROBOT_NOT_FOUND` si no tiene fila. */
  function requireStatus(robotId: RobotId): RobotStateRecord {
    const status = robots.getStatus(robotId);
    if (!status) throw robotNotFound(robotId);
    return status;
  }

  /**
   * Núcleo común de `move` y `moveLegacy` (pasos 5-6 del design §4): evalúa con el vigilante y
   * aplica la transición. Corre dentro de la transacción del llamador. `requestDetail` (sesión y
   * secuencia) se añade al `detail` de T1 (R9.2).
   */
  function evaluateAndApply(
    robotId: RobotId,
    status: RobotStateRecord,
    destination: Point,
    requestDetail: Record<string, unknown>,
  ): MoveOutcome {
    const { state, position, positionQuality } = status;
    const zones = loadZones();

    const decision = evaluateMovement({
      state,
      positionQuality,
      origin: position,
      destination,
      zones,
      pad,
    });

    // Snapshot de las zonas usadas en la decisión; `[]` cuando el repositorio falló.
    const zonesSnapshot = zones ?? [];

    if (decision.authorized) {
      // AUTHORIZED: T1 (MOVING persistido) y T2 (MOVING -> IDLE en la misma solicitud,
      // DD-209, R1.5) con la posición final en el destino.
      const moving = applyDecision(state, decision);
      transition({
        robotId,
        from: state,
        to: moving,
        cause: 'AUTHORIZED',
        position,
        positionQuality,
        detail: { destination, ...requestDetail },
      });
      const nextState = completeMove(moving);
      transition({
        robotId,
        from: moving,
        to: nextState,
        cause: 'MOVE_COMPLETED',
        position: destination,
        positionQuality,
      });
      return { decision: 'AUTHORIZED', state: nextState, position: destination };
    }

    if (!isStoppingDenial(decision.code)) {
      // R3.3: sin cambios de estado ni posición ni transición. R5.3: se audita, no se
      // crea incidente.
      audit.record({
        robotId,
        eventCode: decision.code as 'SAFE_STOP_ACTIVE' | 'BUSY',
        state,
        position: destination,
      });
      return {
        decision: 'REJECTED',
        code: decision.code,
        state,
        position,
        reason: decision.reason,
      };
    }

    // Denegación que para (geometría o datos): crea el incidente inmutable (R5.2) y aplica
    // T3/T4 con su `incidentId`, conservando la posición (R3.1/R3.2/R3.3).
    const nextState = applyDecision(state, decision);
    const rule = ruleForDecision(decision.code);
    if (rule === null) throw new Error(`No rule for denial ${decision.code}`);
    const incidentId = incidents.create({
      robotId,
      rule,
      zoneName: decision.zoneName ?? null,
      decisionCode: decision.code,
      collisionType: decision.collisionType,
      stateAfter: nextState,
      origin: position,
      destination,
      zonesSnapshot,
      reason: decision.reason,
    }).id;
    transition({
      robotId,
      from: state,
      to: nextState,
      cause: decision.code,
      position,
      positionQuality,
      detail: { incidentId },
    });

    return {
      decision: 'DENIED',
      code: decision.code,
      state: nextState,
      position,
      collisionType: decision.collisionType,
      incidentId,
      rule,
      zoneName: decision.zoneName ?? null,
      reason: decision.reason,
    };
  }

  return {
    getState(robotId) {
      const { state, position, positionQuality } = requireStatus(robotId);
      return { state, position, positionQuality };
    },

    getStatus(robotId) {
      const { state, position, positionQuality } = requireStatus(robotId);
      return {
        robotId,
        state,
        position,
        positionQuality,
        lastRequest: sessions.getLastRequest(robotId),
      };
    },

    move(robotId, cmd) {
      return runInTransaction(() => {
        const status = requireStatus(robotId);
        assertDestinationWithinFloor(cmd.destination);
        // R11.5: sesión y secuencia antes que el vigilante; un rechazo ya quedó auditado y la
        // transacción se confirma con su fila (Property 16).
        const accepted = sessions.acceptRequest(robotId, cmd, status.state);
        if (accepted.kind === 'rejected') return accepted;
        const outcome = evaluateAndApply(robotId, status, cmd.destination, {
          sessionId: cmd.sessionId,
          sequence: cmd.sequence,
        });
        return { ...outcome, robotId, positionQuality: status.positionQuality };
      });
    },

    moveLegacy(robotId, destination) {
      return runInTransaction(() => {
        const status = requireStatus(robotId);
        assertDestinationWithinFloor(destination);
        return evaluateAndApply(robotId, status, destination, {});
      });
    },

    recover(robotId) {
      return runInTransaction(() => {
        const { state, position, positionQuality } = requireStatus(robotId);
        const response = (next: RobotStateName, transitioned: boolean): RecoverOutcome => ({
          kind: 'ok',
          value: { robotId, state: next, position, positionQuality, transitioned },
        });

        // R4.5: fuera de parada (IDLE, o un estado transitorio) la recuperación es idempotente:
        // sin transición, solo se audita. R9.6: no hay fila en state_transition_log.
        if (state !== 'SAFE_STOP' && state !== 'DEGRADED') {
          audit.record({ robotId, eventCode: 'RECOVER_NOOP', state });
          return response(state, false);
        }

        // R4.4: datos confiables, zonas legibles y posición segura (regla pura).
        const zones = loadZones();
        const verdict = evaluateRecovery({ positionQuality, position, zones, pad });
        if (!verdict.allowed) {
          // Property 16: el rechazo se audita y la transacción se confirma (no lanza).
          audit.record({
            robotId,
            eventCode: 'RECOVERY_NOT_ALLOWED',
            state,
            position,
            detail: { cause: verdict.cause },
          });
          return {
            kind: 'rejected',
            code: 'RECOVERY_NOT_ALLOWED',
            status: 409,
            cause: verdict.cause,
            message: RECOVERY_REASON[verdict.cause],
          };
        }

        // R4.1: T6 (-> RECOVERING) y T7 (-> IDLE, con el snapshot de zonas); conserva la posición.
        transition({
          robotId,
          from: state,
          to: 'RECOVERING',
          cause: 'RECOVER_REQUESTED',
          position,
          positionQuality,
        });
        transition({
          robotId,
          from: 'RECOVERING',
          to: 'IDLE',
          cause: 'RECOVER_COMPLETED',
          position,
          positionQuality,
          detail: { zonesSnapshot: zones ?? [] },
        });
        return response('IDLE', true);
      });
    },

    checkStartPosition(position, robot) {
      return runInTransaction(() => {
        const verdict = evaluateStartPosition({ position, zones: loadZones(), pad });
        if (verdict.allowed) return { kind: 'ok', value: undefined };

        // Zonas no legibles: no se puede verificar (decisión 1, rev4); el resto: posición comprobada
        // dentro de una zona activa. En ambos casos el robot aún no existe: robot_id/state nulos.
        const unverifiable = verdict.reason === 'ZONE_DATA_UNAVAILABLE';
        const code = unverifiable ? 'ROBOT_START_NOT_VERIFIABLE' : 'ROBOT_START_IN_RESTRICTED_ZONE';
        audit.record({
          robotId: null,
          eventCode: code,
          state: null,
          position,
          detail: unverifiable
            ? { name: robot.name, type: robot.type, cause: 'ZONE_DATA_UNAVAILABLE' }
            : { name: robot.name, type: robot.type },
        });
        const message = unverifiable
          ? 'Zone data is unavailable; the start position cannot be verified'
          : 'Start position is inside a restricted zone';
        return unverifiable
          ? { kind: 'rejected', code, status: 409, cause: 'ZONE_DATA_UNAVAILABLE', message }
          : { kind: 'rejected', code, status: 409, message };
      });
    },

    initRobot(robotId, position) {
      runInTransaction(() => {
        // Defensa en profundidad: el catálogo ya llamó a `checkStartPosition`.
        const verdict = evaluateStartPosition({ position, zones: loadZones(), pad });
        if (!verdict.allowed) {
          throw new Error(
            verdict.reason === 'ZONE_DATA_UNAVAILABLE'
              ? 'Cannot register robot: zone data is unavailable'
              : 'Cannot register robot: start position is inside a restricted zone',
          );
        }
        robots.insertInitial(robotId, position);
        // T9: alta, sin estado previo (no pasa por `canTransition`).
        transitions.append({
          robotId,
          fromState: null,
          toState: 'IDLE',
          cause: 'ROBOT_REGISTERED',
        });
      });
    },

    setPosition(robotId, reading) {
      return runInTransaction(() => {
        const { state, position, positionQuality } = requireStatus(robotId);
        const received = reading.position;
        const previous = { position, quality: positionQuality };

        if (reading.quality === 'RELIABLE') {
          // R8.5: fuera del plano → 422; no coincidente → 409 sin cambios. Nunca relocaliza.
          assertPositionWithinFloor(received);
          if (received.x !== position.x || received.y !== position.y) {
            audit.record({
              robotId,
              eventCode: 'POSITION_CONFLICT',
              state,
              position: received,
              detail: { previous, received: { position: received, quality: reading.quality } },
            });
            return {
              kind: 'rejected',
              code: 'POSITION_CONFLICT',
              status: 409,
              message: 'Reliable reading does not match the current position of the robot',
            };
          }
          robots.saveQuality(robotId, 'RELIABLE');
          audit.record({
            robotId,
            eventCode: 'POSITION_READING',
            state,
            position: received,
            detail: { quality: reading.quality, previous },
          });
          return { kind: 'ok', value: { state, position, positionQuality: 'RELIABLE' } };
        }

        // R8.6: señal de pérdida. Se acepta sin validar la posición recibida (se ignora y solo
        // se audita); fija la calidad y aplica R3.6 / R5.11 desde IDLE.
        robots.saveQuality(robotId, reading.quality);
        audit.record({
          robotId,
          eventCode: 'POSITION_READING',
          state,
          position: received,
          detail: { quality: reading.quality, previous },
        });
        if (state !== 'IDLE') {
          // En parada, o con un movimiento transitorio, solo cambia la calidad (sin incidente).
          return { kind: 'ok', value: { state, position, positionQuality: reading.quality } };
        }

        // T5 IDLE -> DEGRADED con su incidente R-SIGNAL-01 (origen = destino = posición actual).
        const rule = ruleForDecision('POSITION_QUALITY_LOST');
        if (rule === null) throw new Error('No rule for POSITION_QUALITY_LOST');
        const incidentId = incidents.create({
          robotId,
          rule,
          zoneName: null,
          decisionCode: 'POSITION_QUALITY_LOST',
          collisionType: null,
          stateAfter: 'DEGRADED',
          origin: position,
          destination: position,
          // Sin zonas consultadas: la pérdida de señal no evalúa geometría (art. XV).
          zonesSnapshot: [],
          reason: `Position quality lost (${reading.quality}); robot degraded`,
        }).id;
        transition({
          robotId,
          from: 'IDLE',
          to: 'DEGRADED',
          cause: 'POSITION_QUALITY_LOST',
          position,
          positionQuality: reading.quality,
          detail: { incidentId },
        });
        return {
          kind: 'ok',
          value: { state: 'DEGRADED', position, positionQuality: reading.quality },
        };
      });
    },
  };
}
