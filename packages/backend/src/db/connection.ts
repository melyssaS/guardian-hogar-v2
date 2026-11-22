import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/** Abre una base SQLite. `:memory:` para pruebas (RF-04.1, DD-005). */
export function createDatabase(filename: string): Db {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

let instance: Db | null = null;

/** Instancia única de la aplicación. Archivo desde `DB_FILE` (por defecto `data/guardian.db`). */
export function getDb(): Db {
  if (!instance) instance = createDatabase(process.env.DB_FILE ?? 'data/guardian.db');
  return instance;
}
