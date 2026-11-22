import type { Zone, ZoneInput } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

export type ZoneListFilter = 'active' | 'inactive' | 'all';

/** El nombre ya existe (violación de UNIQUE en SQLite, DD-006). */
export class DuplicateZoneNameError extends Error {
  constructor() {
    super('Zone name already exists');
    this.name = 'DuplicateZoneNameError';
  }
}

export interface ZoneRepository {
  create(input: ZoneInput): Zone;
  findById(id: number): Zone | null;
  findAll(filter: ZoneListFilter): Zone[];
  update(id: number, input: ZoneInput): Zone | null;
  delete(id: number): boolean;
  existsByName(name: string, exceptId?: number): boolean;
}

interface ZoneRow {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  active: 0 | 1;
  created_at: string;
}

function toZone(row: ZoneRow): Zone {
  return {
    id: row.id,
    name: row.name,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    active: row.active === 1,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toParams(input: ZoneInput) {
  return {
    name: input.name,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    active: input.active ? 1 : 0,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

const WHERE_BY_FILTER: Record<ZoneListFilter, string> = {
  active: 'WHERE active = 1',
  inactive: 'WHERE active = 0',
  all: '',
};

/** Repositorio SQLite de zonas. Todas las consultas son parametrizadas (RF-04.1). */
export function createZoneRepository(db: Db): ZoneRepository {
  const insertStmt = db.prepare(
    `INSERT INTO zones (name, x, y, width, height, active)
     VALUES (@name, @x, @y, @width, @height, @active)`,
  );
  const findByIdStmt = db.prepare('SELECT * FROM zones WHERE id = ?');
  const updateStmt = db.prepare(
    `UPDATE zones SET name = @name, x = @x, y = @y, width = @width, height = @height,
     active = @active WHERE id = @id`,
  );
  const deleteStmt = db.prepare('DELETE FROM zones WHERE id = ?');
  const existsStmt = db.prepare('SELECT 1 FROM zones WHERE name = ? AND id <> ? LIMIT 1');
  const listStmts = {
    active: db.prepare<[], ZoneRow>(`SELECT * FROM zones ${WHERE_BY_FILTER.active} ORDER BY id`),
    inactive: db.prepare<[], ZoneRow>(
      `SELECT * FROM zones ${WHERE_BY_FILTER.inactive} ORDER BY id`,
    ),
    all: db.prepare<[], ZoneRow>(`SELECT * FROM zones ${WHERE_BY_FILTER.all} ORDER BY id`),
  } satisfies Record<ZoneListFilter, unknown>;

  const findById = (id: number): Zone | null => {
    const row = findByIdStmt.get(id) as ZoneRow | undefined;
    return row ? toZone(row) : null;
  };

  const withUniqueCheck = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateZoneNameError();
      throw err;
    }
  };

  return {
    create(input) {
      const result = withUniqueCheck(() => insertStmt.run(toParams(input)));
      return findById(Number(result.lastInsertRowid)) as Zone;
    },
    findById,
    findAll(filter) {
      return listStmts[filter].all().map(toZone);
    },
    update(id, input) {
      const result = withUniqueCheck(() => updateStmt.run({ ...toParams(input), id }));
      return result.changes === 0 ? null : findById(id);
    },
    delete(id) {
      return deleteStmt.run(id).changes > 0;
    },
    existsByName(name, exceptId = -1) {
      return existsStmt.get(name, exceptId) !== undefined;
    },
  };
}
