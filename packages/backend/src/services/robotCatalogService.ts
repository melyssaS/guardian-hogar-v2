import type {
  LastRequest,
  Point,
  Robot,
  RobotId,
  RobotInput,
  RobotType,
  ServiceResult,
} from '@home-guardian/domain';
import { robotNameDuplicate, robotNotFound } from '../errors/AppError.js';
import type {
  RobotCatalogEntry,
  RobotCatalogRepository,
} from '../repositories/robotCatalogRepository.js';
import type { RobotRepository } from '../repositories/robotRepository.js';

/** Posición de inicio de todo robot registrado por la API (spec 003 RF-07.4, DD-118). */
const START_POSITION: Point = { x: 120, y: 90 };

/** Dependencias del catálogo (inyección manual, SOLID-D). */
export interface RobotCatalogServiceDeps {
  catalog: RobotCatalogRepository;
  /** Solo lectura del estado (`getStatus`); el catálogo NUNCA escribe `robot_state` (Property 12). */
  robots: Pick<RobotRepository, 'getStatus'>;
  sessions: { getLastRequest(robotId: RobotId): LastRequest | null };
  /** El alta es una decisión de seguridad del vigilante (spec 002 R12.2). */
  guardian: {
    checkStartPosition(
      position: Point,
      robot: { name: string; type: RobotType },
    ): ServiceResult<void>;
    initRobot(robotId: RobotId, position: Point): void;
  };
  /** Transacción `IMMEDIATE` del alta: robots + estado inicial + T9 se confirman o revierten juntos. */
  runInTransaction: <T>(fn: () => T) => T;
}

export interface RobotCatalogService {
  /**
   * Registra un robot (spec 003 R7). Orden (RF-07.10): nombre duplicado (409 `ROBOT_NAME_DUPLICATE`,
   * lanza) → `checkStartPosition` (409 auditado por la 002, como resultado `rejected`) → `INSERT
   * robots` → `initRobot`. El `rejected` confirma la transacción con la fila de auditoría y no
   * crea nada.
   */
  register(input: RobotInput): ServiceResult<Robot>;
  list(): Robot[];
  /** `404 ROBOT_NOT_FOUND` si no existe. */
  get(robotId: RobotId): Robot;
}

/**
 * Catálogo de robots simulados (spec 003, RF-07). Compone la fila de `robots` con el estado de
 * seguridad que decide y guarda el vigilante; no lo escribe ni lo calcula.
 */
export function createRobotCatalogService(deps: RobotCatalogServiceDeps): RobotCatalogService {
  const { catalog, robots, sessions, guardian, runInTransaction } = deps;

  function toRobot(entry: RobotCatalogEntry): Robot {
    const status = robots.getStatus(entry.id);
    if (!status) throw new Error(`robot ${entry.id} has no robot_state row`);
    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      createdAt: entry.createdAt,
      state: status.state,
      position: status.position,
      positionQuality: status.positionQuality,
      lastRequest: sessions.getLastRequest(entry.id),
    };
  }

  return {
    register(input) {
      return runInTransaction(() => {
        // 2) nombre duplicado, antes de decidir la posición (no se audita). La restricción
        // UNIQUE(name) sigue como red de seguridad.
        if (catalog.findByName(input.name) !== null) throw robotNameDuplicate(input.name);

        // 3) posición de inicio: la decisión y su auditoría son del vigilante.
        const check = guardian.checkStartPosition(START_POSITION, {
          name: input.name,
          type: input.type,
        });
        if (check.kind === 'rejected') return check;

        let created: RobotCatalogEntry;
        try {
          created = catalog.create(input);
        } catch (error) {
          if (error instanceof Error && /UNIQUE/.test(error.message)) {
            throw robotNameDuplicate(input.name);
          }
          throw error;
        }
        guardian.initRobot(created.id, START_POSITION);
        return { kind: 'ok', value: toRobot(created) };
      });
    },

    list() {
      return catalog.list().map(toRobot);
    },

    get(robotId) {
      const entry = catalog.findById(robotId);
      if (!entry) throw robotNotFound(robotId);
      return toRobot(entry);
    },
  };
}
