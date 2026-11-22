/** El nombre ya existe (violación de UNIQUE en SQLite, DD-006). */
export class DuplicateZoneNameError extends Error {
    constructor() {
        super('Zone name already exists');
        this.name = 'DuplicateZoneNameError';
    }
}
function toZone(row) {
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
function toParams(input) {
    return {
        name: input.name,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        active: input.active ? 1 : 0,
    };
}
function isUniqueViolation(err) {
    return (typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        err.code === 'SQLITE_CONSTRAINT_UNIQUE');
}
const WHERE_BY_FILTER = {
    active: 'WHERE active = 1',
    inactive: 'WHERE active = 0',
    all: '',
};
/** Repositorio SQLite de zonas. Todas las consultas son parametrizadas (RF-04.1). */
export function createZoneRepository(db) {
    const insertStmt = db.prepare(`INSERT INTO zones (name, x, y, width, height, active)
     VALUES (@name, @x, @y, @width, @height, @active)`);
    const findByIdStmt = db.prepare('SELECT * FROM zones WHERE id = ?');
    const updateStmt = db.prepare(`UPDATE zones SET name = @name, x = @x, y = @y, width = @width, height = @height,
     active = @active WHERE id = @id`);
    const deleteStmt = db.prepare('DELETE FROM zones WHERE id = ?');
    const existsStmt = db.prepare('SELECT 1 FROM zones WHERE name = ? AND id <> ? LIMIT 1');
    const listStmts = {
        active: db.prepare(`SELECT * FROM zones ${WHERE_BY_FILTER.active} ORDER BY id`),
        inactive: db.prepare(`SELECT * FROM zones ${WHERE_BY_FILTER.inactive} ORDER BY id`),
        all: db.prepare(`SELECT * FROM zones ${WHERE_BY_FILTER.all} ORDER BY id`),
    };
    const findById = (id) => {
        const row = findByIdStmt.get(id);
        return row ? toZone(row) : null;
    };
    const withUniqueCheck = (fn) => {
        try {
            return fn();
        }
        catch (err) {
            if (isUniqueViolation(err))
                throw new DuplicateZoneNameError();
            throw err;
        }
    };
    return {
        create(input) {
            const result = withUniqueCheck(() => insertStmt.run(toParams(input)));
            return findById(Number(result.lastInsertRowid));
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
