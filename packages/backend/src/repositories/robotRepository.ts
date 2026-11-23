import type { PositionQuality, RobotSnapshot, RobotStateName } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Snapshot completo del robot incluyendo la calidad de posición (spec 002, §4). */
export interface RobotFullSnapshot {
  state: RobotStateName;
  position: { x: number; y: number };
  positionQuality: PositionQuality;
}

/**
 * Acceso a la fila única `robot_state` (spec 003, DD-103).
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
}

interface RobotRow {
  state: RobotStateName;
  pos_x: number;
  pos_y: number;
  position_quality: PositionQuality;
}

/** Repositorio SQLite del robot. Todas las consultas son parametrizadas. */
export function createRobotRepository(db: Db): RobotRepository {
  const getStmt = db.prepare<[], RobotRow>(
    'SELECT state, pos_x, pos_y, position_quality FROM robot_state WHERE id = 1',
  );
  // Spec 003: no toca position_quality para no sobrescribir la calidad vigente.
  const saveStmt = db.prepare(
    `UPDATE robot_state
     SET state = @state, pos_x = @x, pos_y = @y,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = 1`,
  );
  // Spec 002: persiste estado, posición y calidad en la misma sentencia (§4).
  const saveFullStmt = db.prepare(
    `UPDATE robot_state
     SET state = @state, pos_x = @x, pos_y = @y, position_quality = @quality,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = 1`,
  );
  // Spec 002: actualiza solo la calidad de posición (señal de pérdida explícita).
  const setQualityStmt = db.prepare(
    `UPDATE robot_state
     SET position_quality = @quality,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = 1`,
  );

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
  };
}
