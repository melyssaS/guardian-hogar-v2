import type {
  Point,
  PositionQuality,
  RobotId,
  RobotStateName,
  RobotStatus,
} from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Estado de seguridad de un robot (la `lastRequest` la aporta la sesión, spec 003). */
export type RobotStateRecord = Omit<RobotStatus, 'lastRequest'>;

/**
 * Acceso a `robot_state`, una fila por robot (spec 002 R12.1; DD-103). Es el único módulo de `src`
 * con SQL sobre esa tabla (Property 12). Solo `guardianService` y el arranque (`db/bootstrap.ts`,
 * a través del helper `transition`) usan los métodos de escritura.
 */
export interface RobotRepository {
  /** Spec 002 (por robot): estado, posición y calidad; `null` si el robot no tiene fila. */
  getStatus(robotId: RobotId): RobotStateRecord | null;
  /** Spec 002 (por robot): todos los robots con estado, ordenados por id. */
  findAll(): RobotStateRecord[];
  /** Spec 002 (por robot): persiste estado y posición conservando la calidad. */
  saveState(robotId: RobotId, state: RobotStateName, position: Point): void;
  /** Spec 002 (por robot): fija solo la calidad de posición. */
  saveQuality(robotId: RobotId, quality: PositionQuality): void;
  /**
   * Spec 002 R12.2 (alta): `INSERT` simple del estado inicial `IDLE` / `RELIABLE` en `position`.
   * Lanza si el robot ya tiene fila (nunca reinicia un robot existente) o no existe en `robots`.
   */
  insertInitial(robotId: RobotId, position: Point): void;
}

interface RobotRow {
  robot_id: number;
  state: RobotStateName;
  pos_x: number;
  pos_y: number;
  position_quality: PositionQuality;
}

/** Repositorio SQLite del robot. Todas las consultas son parametrizadas. */
export function createRobotRepository(db: Db): RobotRepository {
  const getStatusStmt = db.prepare<[number], RobotRow>(
    'SELECT robot_id, state, pos_x, pos_y, position_quality FROM robot_state WHERE robot_id = ?',
  );
  const findAllStmt = db.prepare<[], RobotRow>(
    'SELECT robot_id, state, pos_x, pos_y, position_quality FROM robot_state ORDER BY robot_id',
  );
  const saveStateStmt = db.prepare(
    `UPDATE robot_state
     SET state = @state, pos_x = @x, pos_y = @y,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE robot_id = @robotId`,
  );
  const saveQualityStmt = db.prepare(
    `UPDATE robot_state
     SET position_quality = @quality,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE robot_id = @robotId`,
  );

  const insertInitialStmt = db.prepare(
    `INSERT INTO robot_state (robot_id, state, pos_x, pos_y, position_quality)
     VALUES (@robotId, 'IDLE', @x, @y, 'RELIABLE')`,
  );

  const toRecord = (row: RobotRow): RobotStateRecord => ({
    robotId: row.robot_id,
    state: row.state,
    position: { x: row.pos_x, y: row.pos_y },
    positionQuality: row.position_quality,
  });

  return {
    getStatus(robotId) {
      const row = getStatusStmt.get(robotId);
      return row ? toRecord(row) : null;
    },
    findAll() {
      return findAllStmt.all().map(toRecord);
    },
    saveState(robotId, state, position) {
      const { changes } = saveStateStmt.run({ robotId, state, x: position.x, y: position.y });
      // Sin fila no hay nada que actualizar: es un error de programación, no un no-op silencioso.
      if (changes === 0) throw new Error(`robot ${robotId} has no robot_state row`);
    },
    saveQuality(robotId, quality) {
      const { changes } = saveQualityStmt.run({ robotId, quality });
      if (changes === 0) throw new Error(`robot ${robotId} has no robot_state row`);
    },
    insertInitial(robotId, position) {
      insertInitialStmt.run({ robotId, x: position.x, y: position.y });
    },
  };
}
