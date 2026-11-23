import type { RobotInput, RobotType } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Entrada del catálogo `robots` (sin estado de seguridad, que vive en `robot_state`). */
export interface RobotCatalogEntry {
  id: number;
  name: string;
  type: RobotType;
  /** Marca de tiempo ISO-8601. */
  createdAt: string;
}

/** Acceso a la tabla `robots` (spec 003, DD-110). */
export interface RobotCatalogRepository {
  /** Catálogo completo ordenado por id. */
  list(): RobotCatalogEntry[];
  /** Alta de un robot; un nombre duplicado lanza por `UNIQUE(name)`. */
  create(input: RobotInput): RobotCatalogEntry;
  /** Búsqueda por id; `null` si no existe. */
  findById(id: number): RobotCatalogEntry | null;
  /** Búsqueda por nombre exacto (la restricción `UNIQUE(name)` es sensible a mayúsculas). */
  findByName(name: string): RobotCatalogEntry | null;
}

interface RobotCatalogRow {
  id: number;
  name: string;
  type: RobotType;
  created_at: string;
}

function toEntry(row: RobotCatalogRow): RobotCatalogEntry {
  return { id: row.id, name: row.name, type: row.type, createdAt: row.created_at };
}

/** Repositorio SQLite del catálogo de robots. Todas las consultas son parametrizadas. */
export function createRobotCatalogRepository(db: Db): RobotCatalogRepository {
  const listStmt = db.prepare<[], RobotCatalogRow>(
    'SELECT id, name, type, created_at FROM robots ORDER BY id',
  );
  const findStmt = db.prepare<[number], RobotCatalogRow>(
    'SELECT id, name, type, created_at FROM robots WHERE id = ?',
  );
  const findByNameStmt = db.prepare<[string], RobotCatalogRow>(
    'SELECT id, name, type, created_at FROM robots WHERE name = ?',
  );
  const insertStmt = db.prepare('INSERT INTO robots (name, type) VALUES (@name, @type)');

  return {
    list() {
      return listStmt.all().map(toEntry);
    },
    create({ name, type }) {
      const { lastInsertRowid } = insertStmt.run({ name, type });
      const row = findStmt.get(Number(lastInsertRowid));
      if (!row) throw new Error('robot insert did not persist');
      return toEntry(row);
    },
    findById(id) {
      const row = findStmt.get(id);
      return row ? toEntry(row) : null;
    },
    findByName(name) {
      const row = findByNameStmt.get(name);
      return row ? toEntry(row) : null;
    },
  };
}
