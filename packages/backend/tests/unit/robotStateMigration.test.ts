import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/connection.js';
import { MIGRATIONS_DIR, migrate } from '../../src/db/migrate.js';

// Spec 002 — RC-5 (R12.1, R12.5, R10.5): 008_robot_state_per_robot.sql

const ROW =
  'SELECT robot_id, state, pos_x, pos_y, position_quality FROM robot_state ORDER BY robot_id';

describe('008_robot_state_per_robot.sql', () => {
  it('en una base nueva A1 queda en (120, 90) y V2 en (488, 290), IDLE y RELIABLE', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    expect(db.prepare(ROW).all()).toEqual([
      { robot_id: 1, state: 'IDLE', pos_x: 120, pos_y: 90, position_quality: 'RELIABLE' },
      { robot_id: 2, state: 'IDLE', pos_x: 488, pos_y: 290, position_quality: 'RELIABLE' },
    ]);
  });

  it('en una base existente copia la fila id = 1 tal cual como A1 y crea V2 aparte', () => {
    // Base con las migraciones hasta la 007 aplicadas y la fila de A1 ya modificada.
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n < '008')) {
      copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    }
    const db = createDatabase(':memory:');
    migrate(db, dir);
    db.prepare(
      "UPDATE robot_state SET state = 'SAFE_STOP', pos_x = 33, pos_y = 44, position_quality = 'UNRELIABLE' WHERE id = 1",
    ).run();

    migrate(db);
    expect(db.prepare(ROW).all()).toEqual([
      { robot_id: 1, state: 'SAFE_STOP', pos_x: 33, pos_y: 44, position_quality: 'UNRELIABLE' },
      { robot_id: 2, state: 'IDLE', pos_x: 488, pos_y: 290, position_quality: 'RELIABLE' },
    ]);
  });

  it('robot_id es la clave y referencia a robots', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    const insert = db.prepare(
      "INSERT INTO robot_state (robot_id, state, pos_x, pos_y, position_quality) VALUES (?, 'IDLE', 0, 0, 'RELIABLE')",
    );
    expect(() => insert.run(1)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => insert.run(99)).toThrow(/FOREIGN KEY/);
  });

  it('admite los 5 estados y rechaza otros', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    for (const state of ['IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING']) {
      expect(() =>
        db.prepare('UPDATE robot_state SET state = ? WHERE robot_id = 2').run(state),
      ).not.toThrow();
    }
    expect(() =>
      db.prepare("UPDATE robot_state SET state = 'TELEPORT' WHERE robot_id = 2").run(),
    ).toThrow(/CHECK/);
  });

  it('position_quality no tiene DEFAULT y su CHECK admite solo 3 valores', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    const robot = db.prepare("INSERT INTO robots (name, type) VALUES ('R3', 'GUARD')").run();
    expect(() =>
      db
        .prepare("INSERT INTO robot_state (robot_id, state, pos_x, pos_y) VALUES (?, 'IDLE', 0, 0)")
        .run(robot.lastInsertRowid),
    ).toThrow(/NOT NULL/);
    expect(() =>
      db.prepare("UPDATE robot_state SET position_quality = 'GOOD' WHERE robot_id = 1").run(),
    ).toThrow(/CHECK/);
    for (const q of ['RELIABLE', 'UNRELIABLE', 'MISSING']) {
      expect(() =>
        db.prepare('UPDATE robot_state SET position_quality = ? WHERE robot_id = 1').run(q),
      ).not.toThrow();
    }
  });

  it('updated_at se escribe en ISO-8601 UTC', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    const row = db.prepare('SELECT updated_at FROM robot_state WHERE robot_id = 2').get() as {
      updated_at: string;
    };
    expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
