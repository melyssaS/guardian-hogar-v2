import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { createDbBefore, createTestDb } from '../helpers.js';

// Spec 002 — RC-6 (R5.5, R5.9): 009_incidents_robot_rule_zone.sql

const OLD_INCIDENT = `INSERT INTO incidents (decision_code, state_after, origin_x, origin_y, dest_x, dest_y, zones_snapshot, reason)
   VALUES ('RESTRICTED_ZONE_VIOLATION', 'SAFE_STOP', 1, 2, 3, 4, '[]', 'antiguo')`;

describe('009_incidents_robot_rule_zone.sql', () => {
  it('añade robot_id, rule y zone_name como columnas anulables', () => {
    const db = createTestDb();
    const cols = db.prepare('PRAGMA table_info(incidents)').all() as Array<{
      name: string;
      notnull: number;
    }>;
    for (const name of ['robot_id', 'rule', 'zone_name']) {
      const col = cols.find((c) => c.name === name);
      expect(col, name).toBeDefined();
      expect(col?.notnull, name).toBe(0);
    }
  });

  it('las filas antiguas se conservan intactas con robot_id, rule y zone_name NULL', () => {
    const db = createDbBefore('009');
    db.prepare(OLD_INCIDENT).run();
    const before = db.prepare('SELECT * FROM incidents').all();

    migrate(db);
    const after = db.prepare('SELECT * FROM incidents').all() as Array<Record<string, unknown>>;
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual({
      ...(before[0] as object),
      robot_id: null,
      rule: null,
      zone_name: null,
    });
  });

  it('robot_id referencia a robots', () => {
    const db = createTestDb();
    const insert = db.prepare(
      `INSERT INTO incidents (robot_id, rule, zone_name, decision_code, state_after, origin_x, origin_y, dest_x, dest_y, zones_snapshot, reason)
       VALUES (?, 'R-ZONA-01', 'Escaleras', 'RESTRICTED_ZONE_VIOLATION', 'SAFE_STOP', 1, 2, 3, 4, '[]', 'nuevo')`,
    );
    expect(() => insert.run(2)).not.toThrow();
    expect(() => insert.run(99)).toThrow(/FOREIGN KEY/);
  });

  it('decision_code no tiene CHECK: admite POSITION_QUALITY_LOST', () => {
    const db = createTestDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO incidents (robot_id, rule, decision_code, state_after, origin_x, origin_y, dest_x, dest_y, zones_snapshot, reason)
           VALUES (1, 'R-SIGNAL-01', 'POSITION_QUALITY_LOST', 'DEGRADED', 1, 1, 1, 1, '[]', 'señal')`,
        )
        .run(),
    ).not.toThrow();
  });

  it('sigue siendo append-only', () => {
    const db = createTestDb();
    db.prepare(OLD_INCIDENT).run();
    expect(() => db.prepare('UPDATE incidents SET rule = ?').run('R-ZONA-01')).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM incidents').run()).toThrow(/append-only/);
  });
});
