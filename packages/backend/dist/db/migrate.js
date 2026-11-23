import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// src/db y dist/db quedan a la misma profundidad respecto a packages/backend/migrations.
export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');
/**
 * Aplica, en orden lexicográfico y dentro de una transacción, las migraciones `NNN_*.sql`
 * aún no registradas en `schema_migrations` (RF-04.2). Devuelve las versiones aplicadas.
 */
export function migrate(db, dir = MIGRATIONS_DIR) {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
    const applied = new Set(db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((row) => row.version));
    const pending = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .filter((f) => !applied.has(f));
    const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
    const applyAll = db.transaction((files) => {
        for (const file of files) {
            db.exec(readFileSync(join(dir, file), 'utf8'));
            record.run(file);
        }
    });
    applyAll(pending);
    return pending;
}
