import { createDatabase, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

export function createTestDb(): Db {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

export const stairs = { name: 'Escaleras', x: 100, y: 100, width: 200, height: 150, active: true };
