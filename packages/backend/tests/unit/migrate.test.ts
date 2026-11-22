import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';

describe('migrate (RF-04.2)', () => {
  it('crea la tabla zones y registra la versión', () => {
    const db = createDatabase(':memory:');
    expect(migrate(db)).toEqual(['001_create_zones.sql']);
    const versions = db.prepare('SELECT version FROM schema_migrations').all();
    expect(versions).toEqual([{ version: '001_create_zones.sql' }]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'zones'").get()).toBeDefined();
  });

  it('es idempotente', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    expect(migrate(db)).toEqual([]);
  });

  it('aplica en orden lexicográfico y revierte todo si una falla', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE b (id INTEGER);');
    writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER);');
    writeFileSync(join(dir, '003_bad.sql'), 'NOT VALID SQL;');
    const db = createDatabase(':memory:');
    expect(() => migrate(db, dir)).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get()).toBeUndefined();
  });
});
