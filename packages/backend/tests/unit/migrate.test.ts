import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';

describe('migrate (RF-04.2)', () => {
  const ALL = ['001_create_zones.sql', '002_create_robot_state.sql', '003_create_movement_log.sql'];

  it('crea las tablas y registra las versiones en orden', () => {
    const db = createDatabase(':memory:');
    expect(migrate(db)).toEqual(ALL);
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions).toEqual(ALL.map((version) => ({ version })));
    for (const table of ['zones', 'robot_state', 'movement_log']) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      ).toBeDefined();
    }
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
