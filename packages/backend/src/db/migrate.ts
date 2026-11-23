import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

// src/db y dist/db quedan a la misma profundidad respecto a packages/backend/migrations.
export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Aplica, en orden lexicográfico y dentro de una transacción, las migraciones `NNN_*.sql`
 * aún no registradas en `schema_migrations` (RF-04.2). Devuelve las versiones aplicadas.
 * Falla sin aplicar nada si una pendiente tiene número menor que la última aplicada (R10.5).
 */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: string }).version),
  );
  const pending = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f));

  // R10.5: una pendiente con número menor que la última aplicada rompe el orden de entrega.
  const lastApplied = [...applied].sort().at(-1);
  if (lastApplied !== undefined) {
    const older = pending.find((file) => migrationNumber(file) < migrationNumber(lastApplied));
    if (older !== undefined) {
      throw new Error(
        `Out-of-order migration: ${older} is older than the last applied migration ${lastApplied}`,
      );
    }
  }

  const record = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');
  const applyAll = db.transaction((files: string[]) => {
    for (const file of files) {
      db.exec(readFileSync(join(dir, file), 'utf8'));
      record.run(file);
    }
  });
  applyAll(pending);
  return pending;
}

/** Número de versión de un archivo `NNN_nombre.sql`; `NaN` si no empieza por dígitos. */
function migrationNumber(file: string): number {
  return Number.parseInt(file, 10);
}
