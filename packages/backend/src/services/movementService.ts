import {
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  type MoveResult,
  type Point,
  type RobotSnapshot,
  type Zone,
} from '@home-guardian/domain';
import { destinationOutOfBounds } from '../errors/AppError.js';
import type { MovementLogRepository } from '../repositories/movementLogRepository.js';
import type { RobotRepository } from '../repositories/robotRepository.js';
import { decideMovement } from '../rules/watchmanRule.js';

/**
 * RF-01.4 / RF-01.5 — CA-03.5. Borde inclusivo: x=0, x=FLOOR_WIDTH, y=0 e y=FLOOR_HEIGHT
 * son válidos (comparaciones estrictas). Fuera del plano → 422 DESTINATION_OUT_OF_BOUNDS.
 */
export function assertDestinationWithinFloor(p: Point): void {
  if (p.x < 0 || p.y < 0 || p.x > FLOOR_WIDTH || p.y > FLOOR_HEIGHT) {
    throw destinationOutOfBounds();
  }
}

/** Dependencias inyectadas manualmente (SOLID-D, design §3). */
export interface MovementServiceDeps {
  robots: RobotRepository;
  movementLog: MovementLogRepository;
  /** Zonas activas vigentes en el momento de la evaluación. */
  getActiveZones: () => Zone[];
  /** Ejecuta `fn` de forma atómica (estado + registro en la misma transacción). */
  runInTransaction: <T>(fn: () => T) => T;
  /** Pad r + m; por defecto el de la regla (COLLISION_PAD). */
  pad?: number;
}

export interface MovementService {
  getRobot(): RobotSnapshot;
  move(destination: Point): MoveResult;
  reset(): RobotSnapshot;
}

/** Orquesta la simulación de movimiento (HU-03). La decisión la toma `decideMovement`. */
export function createMovementService(deps: MovementServiceDeps): MovementService {
  const { robots, movementLog, getActiveZones, runInTransaction, pad } = deps;

  return {
    getRobot() {
      return robots.get();
    },

    move(destination) {
      assertDestinationWithinFloor(destination);

      return runInTransaction(() => {
        const robot = robots.get();
        const result = decideMovement({
          state: robot.state,
          origin: robot.position,
          destination,
          activeZones: getActiveZones(),
          pad,
        });

        if (result.decision === 'ALLOW') {
          // MOVING es instantáneo en este prototipo: se persiste la posición final en IDLE.
          robots.save({ state: 'IDLE', position: result.position });
        } else if (result.decision === 'PREVENTIVE_STOP') {
          robots.save({ state: 'SAFE_STOP', position: robot.position });
        }
        // DENIED_SAFE_STOP: sin cambios de estado ni de posición (RF-03.3).

        movementLog.append({ origin: robot.position, destination, result }); // RF-05.1
        return result;
      });
    },

    /** DD-106: única salida de SAFE_STOP en alcance. Conserva la posición. */
    reset() {
      return runInTransaction(() => {
        const { position } = robots.get();
        const snapshot: RobotSnapshot = { state: 'IDLE', position };
        robots.save(snapshot);
        return snapshot;
      });
    },
  };
}
