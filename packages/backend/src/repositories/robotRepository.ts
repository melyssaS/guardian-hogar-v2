import type { RobotSnapshot, RobotStateName } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Acceso a la fila única `robot_state` (spec 003, DD-103). */
export interface RobotRepository {
  get(): RobotSnapshot;
  save(snapshot: RobotSnapshot): void;
}

interface RobotRow {
  state: RobotStateName;
  pos_x: number;
  pos_y: number;
}

/** Repositorio SQLite del robot. Todas las consultas son parametrizadas. */
export function createRobotRepository(db: Db): RobotRepository {
  const getStmt = db.prepare<[], RobotRow>(
    'SELECT state, pos_x, pos_y FROM robot_state WHERE id = 1',
  );
  const saveStmt = db.prepare(
    `UPDATE robot_state
     SET state = @state, pos_x = @x, pos_y = @y,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = 1`,
  );

  return {
    get() {
      const row = getStmt.get();
      // La migración 002 inserta la fila; si falta, la base está corrupta.
      if (!row) throw new Error('robot_state row is missing');
      return { state: row.state, position: { x: row.pos_x, y: row.pos_y } };
    },
    save({ state, position }) {
      saveStmt.run({ state, x: position.x, y: position.y });
    },
  };
}
