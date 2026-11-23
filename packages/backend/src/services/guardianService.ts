import {
  COLLISION_PAD,
  expandZone,
  pointInAABB,
  type CollisionType,
  type DecisionCode,
  type Point,
  type PositionQuality,
  type PositionReading,
  type RobotStateName,
  type Zone,
} from '@home-guardian/domain';
import type { AuditLogRepository } from '../repositories/auditLogRepository.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';
import type { RobotRepository } from '../repositories/robotRepository.js';
import { evaluateMovement } from '../rules/guardian.js';
import { applyDecision, completeMove } from '../rules/stateMachine.js';
import { assertDestinationWithinFloor } from './movementService.js';

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
const STOPPING_DENIALS: readonly DecisionCode[] = [
  'ORIGIN_IN_RESTRICTED_ZONE',
  'RESTRICTED_ZONE_VIOLATION',
  'TRAJECTORY_CROSSES_ZONE',
  'INSUFFICIENT_DATA',
  'MISSING_POSITION',
  'ZONE_DATA_UNAVAILABLE',
];

/** Rechazos por estado: no crean incidente; se registran en el log de auditoría (R5.3). */
const STATE_REJECTS: readonly DecisionCode[] = ['SAFE_STOP_ACTIVE', 'BUSY'];

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

/** Recuperación exitosa: `RECOVERING → IDLE` (200, design §5). */
export interface RecoverSuccess {
  recovered: true;
  state: 'IDLE';
  position: Point;
}

/** Recuperación rechazada: precondición no cumplida o fuera de parada; sin efectos (R4.2/R4.3). */
export interface RecoverRejected {
  recovered: false;
  state: RobotStateName;
  position: Point;
  reason: string;
}

export type RecoverOutcome = RecoverSuccess | RecoverRejected;

/** Resultado de aportar una lectura de posición (200, design §5b). */
export interface PositionOutcome {
  state: RobotStateName;
  position: Point;
  positionQuality: PositionQuality;
}

export interface GuardianService {
  /** GET /api/robot/state — estado, posición y calidad de posición actuales. */
  getState(): PositionOutcome;
  /** POST /api/robot/move — evalúa y (si procede) autoriza un movimiento. */
  move(destination: Point): MoveOutcome;
  /** POST /api/robot/recover — recuperación explícita y validada (R4). */
  recover(): RecoverOutcome;
  /** POST /api/robot/position — aporta una lectura; fija posición y calidad (R8, PD-09). */
  setPosition(reading: PositionReading): PositionOutcome;
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
  const { robots, incidents, audit, getActiveZones, runInTransaction, pad } = deps;

  /** Carga las zonas activas; si el repositorio falla, devuelve `null` (fallo seguro, DD-204). */
  function loadZones(): Zone[] | null {
    try {
      return getActiveZones();
    } catch {
      return null;
    }
  }

  /** `true` si el punto está fuera de TODA zona activa (posición segura para recuperar, R4.1). */
  function isSafePosition(point: Point, zones: Zone[]): boolean {
    for (const zone of zones) {
      if (zone.active === false) continue;
      if (pointInAABB(point, expandZone(zone, pad ?? COLLISION_PAD))) return false;
    }
    return true;
  }

  return {
    getState() {
      return robots.getFull();
    },

    move(destination) {
      assertDestinationWithinFloor(destination);

      return runInTransaction(() => {
        const { state, position, positionQuality } = robots.getFull();
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
          // AUTHORIZED: MOVING transitorio → IDLE en la misma solicitud (DD-209, R1.5).
          const nextState = completeMove(applyDecision(state, decision));
          robots.saveFull({ state: nextState, position: destination, positionQuality });
          return { decision: 'AUTHORIZED', state: nextState, position: destination };
        }

        if (STATE_REJECTS.includes(decision.code)) {
          // R3.3: sin cambios de estado ni posición. R5.3: se audita, no se crea incidente.
          audit.append({
            eventCode: decision.code as 'SAFE_STOP_ACTIVE' | 'BUSY',
            state,
            destination,
          });
          return {
            decision: 'REJECTED',
            code: decision.code,
            state,
            position,
            reason: decision.reason,
          };
        }

        // Denegación que para (geometría o datos): persiste la parada conservando la posición
        // (R3.1/R3.2/R3.3) y crea un incidente inmutable (R5.2).
        const nextState = applyDecision(state, decision);
        robots.saveFull({ state: nextState, position, positionQuality });

        const incidentId = STOPPING_DENIALS.includes(decision.code)
          ? incidents.create({
              decisionCode: decision.code,
              collisionType: decision.collisionType,
              stateAfter: nextState,
              origin: position,
              destination,
              zonesSnapshot,
              reason: decision.reason,
            }).id
          : 0;

        return {
          decision: 'DENIED',
          code: decision.code,
          state: nextState,
          position,
          collisionType: decision.collisionType,
          incidentId,
          reason: decision.reason,
        };
      });
    },

    recover() {
      return runInTransaction(() => {
        const { state, position, positionQuality } = robots.getFull();

        // R4.3: fuera de parada, la recuperación es idempotente/rechazada sin efectos.
        if (state !== 'SAFE_STOP' && state !== 'DEGRADED') {
          return {
            recovered: false,
            state,
            position,
            reason: 'Robot is not in a preventive stop; nothing to recover',
          };
        }

        // R4.2: datos confiables requeridos; si no, permanece en parada sin cambios.
        if (positionQuality !== 'RELIABLE') {
          return {
            recovered: false,
            state,
            position,
            reason: 'Position quality is not reliable; cannot recover',
          };
        }

        // R4.2: la posición debe ser segura (fuera de toda zona). Si el repositorio de zonas
        // falla, no se puede confirmar seguridad → se rechaza sin cambios (fallo seguro).
        const zones = loadZones();
        if (zones === null) {
          return {
            recovered: false,
            state,
            position,
            reason: 'Zone data is unavailable; cannot confirm a safe position',
          };
        }
        if (!isSafePosition(position, zones)) {
          return {
            recovered: false,
            state,
            position,
            reason: 'Current position is inside a restricted zone; cannot recover',
          };
        }

        // R4.1: posición segura + datos confiables → RECOVERING → IDLE (conserva la posición).
        robots.saveFull({ state: 'IDLE', position, positionQuality });
        return { recovered: true, state: 'IDLE', position };
      });
    },

    setPosition(reading) {
      return runInTransaction(() => {
        const { state } = robots.getFull();
        // Design §5b: fija posición y calidad; NO evalúa geometría ni cambia el estado (R8.1).
        robots.saveFull({
          state,
          position: reading.position,
          positionQuality: reading.quality,
        });
        return { state, position: reading.position, positionQuality: reading.quality };
      });
    },
  };
}
