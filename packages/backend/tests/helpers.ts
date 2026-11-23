import { createDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

export function createTestDb(): Db {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

/** Filas de `movement_log` sin id ni fecha, en orden de inserción. */
export function readMovementLog(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT decision, state_after, origin_x, origin_y, dest_x, dest_y, collision_type,
              zone_name, reason
       FROM movement_log ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;
}

export const stairs = { name: 'Escaleras', x: 100, y: 100, width: 200, height: 150, active: true };
