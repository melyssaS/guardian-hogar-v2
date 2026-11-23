import type {
  Point,
  PositionQuality,
  RobotId,
  RobotSnapshot,
  RobotStateName,
  RobotStatus,
} from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Snapshot completo del robot incluyendo la calidad de posición (spec 002, §4). */
export interface RobotFullSnapshot {
  state: RobotStateName;
  position: { x: number; y: number };
  positionQuality: PositionQuality;
}

/** Estado de seguridad de un robot (la `lastRequest` la aporta la sesión, spec 003). */
export type RobotStateRecord = Omit<RobotStatus, 'lastRequest'>;

/**
 * Acceso a la fila de A1 (`robot_id = 1`) de `robot_state` (spec 003, DD-103; spec 002 RC-5).
 * Los métodos por robot (`getStatus`, `findAll`, `saveState`, `saveQuality`; spec 002 RC-10)
 * son la vía definitiva; los antiguos `get`/`save`/`getFull`/`saveFull`/`*PositionQuality`
 * se retiran en RC-20.
 *
 * `get`/`save` conservan el contrato de dos campos de la spec 003 (`RobotSnapshot`:
 * `state` + `position`) para no romper a `movementService`. Los métodos marcados como
 * «spec 002» leen y escriben además la columna `position_quality` (migración 005).
 */
export interface RobotRepository {
  /** Spec 003: estado y posición del robot (sin tocar `position_quality`). */
  get(): RobotSnapshot;
  /** Spec 003: actualiza estado y posición (conserva `position_quality`). */
  save(snapshot: RobotSnapshot): void;
  /** Spec 002: snapshot completo con `positionQuality` (lo consume `guardianService`, §4). */
  getFull(): RobotFullSnapshot;
  /** Spec 002: persiste estado, posición y `positionQuality` de forma atómica (§4, DD-210). */
  saveFull(snapshot: RobotFullSnapshot): void;
  /** Spec 002: lee solo la calidad de posición del robot (ADR-10, R6). */
  getPositionQuality(): PositionQuality;
  /** Spec 002: fija solo la calidad de posición (señal de pérdida explícita, §5b/ADR-10). */
  setPositionQuality(quality: PositionQuality): void;
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
  const getStmt = db.prepare<[], RobotRow>(
    'SELECT state, pos_x, pos_y, position_quality FROM robot_state WHERE robot_id = 1',
  );
  // Spec 003: no toca position_quality para no sobrescribir la calidad vigente.
  const saveStmt = db.prepare(
    `UPDATE robot_state
     SET state = @state, pos_x = @x, pos_y = @y,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE robot_id = 1`,
  );
  // Spec 002: persiste estado, posición y calidad en la misma sentencia (§4).
  const saveFullStmt = db.prepare(
    `UPDATE robot_state
     SET state = @state, pos_x = @x, pos_y = @y, position_quality = @quality,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE robot_id = 1`,
  );
  // Spec 002: actualiza solo la calidad de posición (señal de pérdida explícita).
  const setQualityStmt = db.prepare(
    `UPDATE robot_state
     SET position_quality = @quality,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE robot_id = 1`,
  );

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

  // La migración 002/005 inserta la fila; si falta, la base está corrupta.
  function requireRow(): RobotRow {
    const row = getStmt.get();
    if (!row) throw new Error('robot_state row is missing');
    return row;
  }

  return {
    get() {
      const row = requireRow();
      return { state: row.state, position: { x: row.pos_x, y: row.pos_y } };
    },
    save({ state, position }) {
      saveStmt.run({ state, x: position.x, y: position.y });
    },
    getFull() {
      const row = requireRow();
      return {
        state: row.state,
        position: { x: row.pos_x, y: row.pos_y },
        positionQuality: row.position_quality,
      };
    },
    saveFull({ state, position, positionQuality }) {
      saveFullStmt.run({ state, x: position.x, y: position.y, quality: positionQuality });
    },
    getPositionQuality() {
      return requireRow().position_quality;
    },
    setPositionQuality(quality) {
      setQualityStmt.run({ quality });
    },
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
