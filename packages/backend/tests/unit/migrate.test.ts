import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/connection.js';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';

describe('migrate (RF-04.2)', () => {
  // Lista derivada del directorio para no acoplarse a migraciones añadidas por otras HU.
  const ALL = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  it('crea las tablas y registra las versiones en orden', () => {
    const db = createDatabase(':memory:');
    expect(migrate(db)).toEqual(ALL);
    const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions).toEqual(ALL.map((version) => ({ version })));
    // Spec 002, R5.1/R5.3: incidents y audit_log quedan creadas y son append-only.
    for (const table of ['zones', 'robot_state', 'movement_log', 'incidents', 'audit_log']) {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
      ).toBeDefined();
    }
  });

  it('incidents y audit_log rechazan UPDATE y DELETE (append-only, R5.4/R5.3)', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    db.prepare(
      `INSERT INTO incidents (decision_code, state_after, origin_x, origin_y, dest_x, dest_y, zones_snapshot, reason)
       VALUES ('RESTRICTED_ZONE_VIOLATION', 'SAFE_STOP', 0, 0, 10, 10, '[]', 'test')`,
    ).run();
    expect(() => db.prepare('UPDATE incidents SET reason = ?').run('x')).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM incidents').run()).toThrow(/append-only/);

    db.prepare(
      `INSERT INTO audit_log (event_code, state, dest_x, dest_y) VALUES ('BUSY', 'MOVING', 5, 5)`,
    ).run();
    expect(() => db.prepare('UPDATE audit_log SET state = ?').run('IDLE')).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/);
  });

  it('robot_state tiene position_quality RELIABLE sembrado y CHECK de estado ampliado (R6.1/R6.3)', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    // R6.1: el robot sembrado (id=1) arranca IDLE, con posición válida y calidad confiable.
    expect(
      db
        .prepare('SELECT state, pos_x, pos_y, position_quality FROM robot_state WHERE id = 1')
        .get(),
    ).toEqual({ state: 'IDLE', pos_x: 120, pos_y: 90, position_quality: 'RELIABLE' });
    // R6.3 / §2.1: el CHECK ahora admite DEGRADED y RECOVERING sin violarse.
    expect(() =>
      db.prepare("UPDATE robot_state SET state = 'DEGRADED' WHERE id = 1").run(),
    ).not.toThrow();
    expect(() =>
      db.prepare("UPDATE robot_state SET state = 'RECOVERING' WHERE id = 1").run(),
    ).not.toThrow();
    // Un estado inexistente sigue rechazándose.
    expect(() =>
      db.prepare("UPDATE robot_state SET state = 'TELEPORT' WHERE id = 1").run(),
    ).toThrow();
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
