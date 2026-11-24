import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createDbBefore, createTestDb } from '../helpers.js';

// Spec 002 — RC-8 (R5.8–R5.10, R8.7): 011_audit_log_generalize.sql

const INSERT = 'INSERT INTO audit_log (robot_id, event_code, state, x, y) VALUES (?, ?, ?, 1, 2)';

describe('011_audit_log_generalize.sql', () => {
  it('conserva intactas las filas antiguas con robot_id NULL', () => {
    const db = createDbBefore('011');
    db.prepare(
      "INSERT INTO audit_log (event_code, state, dest_x, dest_y) VALUES ('SAFE_STOP_ACTIVE', 'SAFE_STOP', 7, 8)",
    ).run();
    db.prepare(
      "INSERT INTO audit_log (event_code, state, dest_x, dest_y) VALUES ('BUSY', 'MOVING', 9, 10)",
    ).run();
    const before = db.prepare('SELECT id, event_code, state, created_at FROM audit_log').all();

    migrate(db);
    const after = db
      .prepare(
        'SELECT id, event_code, state, created_at, robot_id, x, y, detail FROM audit_log ORDER BY id',
      )
      .all();
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual({
      ...(before[0] as object),
      robot_id: null,
      x: 7,
      y: 8,
      detail: null,
    });
    expect(after[1]).toEqual({
      ...(before[1] as object),
      robot_id: null,
      x: 9,
      y: 10,
      detail: null,
    });
  });

  it('x, y y detail existen y no hay columnas dest_x/dest_y', () => {
    const cols = (
      createTestDb().prepare('PRAGMA table_info(audit_log)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['robot_id', 'x', 'y', 'detail', 'state']));
    expect(cols).not.toContain('dest_x');
    expect(cols).not.toContain('dest_y');
  });

  it('los rechazos de alta se insertan sin robot ni estado', () => {
    const db = createTestDb();
    for (const code of ['ROBOT_START_IN_RESTRICTED_ZONE', 'ROBOT_START_NOT_VERIFIABLE']) {
      expect(() => db.prepare(INSERT).run(null, code, null), code).not.toThrow();
    }
  });

  it('cualquier otro evento sin robot_id o sin state falla', () => {
    const db = createTestDb();
    expect(() => db.prepare(INSERT).run(null, 'BUSY', 'MOVING')).toThrow(/robot_id|state/);
    expect(() => db.prepare(INSERT).run(1, 'BUSY', null)).toThrow(/robot_id|state/);
    expect(() => db.prepare(INSERT).run(1, 'SESSION_STARTED', 'IDLE')).not.toThrow();
  });

  it('el CHECK de event_code admite el catálogo y rechaza otros', () => {
    const db = createTestDb();
    for (const code of [
      'SAFE_STOP_ACTIVE',
      'BUSY',
      'INVALID_SESSION',
      'DUPLICATE_EVENT',
      'SESSION_STARTED',
      'RECOVER_NOOP',
      'RECOVERY_NOT_ALLOWED',
      'POSITION_READING',
      'POSITION_CONFLICT',
    ]) {
      expect(() => db.prepare(INSERT).run(1, code, 'IDLE'), code).not.toThrow();
    }
    expect(() => db.prepare(INSERT).run(1, 'MADE_UP', 'IDLE')).toThrow(/CHECK/);
  });

  it('robot_id referencia a robots', () => {
    expect(() => createTestDb().prepare(INSERT).run(99, 'BUSY', 'IDLE')).toThrow(/FOREIGN KEY/);
  });

  it('sigue siendo append-only', () => {
    const db = createTestDb();
    db.prepare(INSERT).run(1, 'BUSY', 'MOVING');
    expect(() => db.prepare('UPDATE audit_log SET state = ?').run('IDLE')).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/);
  });
});

describe('auditLogRepository tras la 011', () => {
  it('record escribe el robot_id recibido, x/y y el detail como JSON', () => {
    const db = createTestDb();
    const repo = createAuditLogRepository(db);
    repo.record({
      robotId: 2,
      eventCode: 'SAFE_STOP_ACTIVE',
      state: 'SAFE_STOP',
      position: { x: 30, y: 40 },
      detail: { note: 'x' },
    });
    repo.record({ robotId: 1, eventCode: 'RECOVER_NOOP', state: 'IDLE' });
    expect(
      db
        .prepare('SELECT robot_id, event_code, state, x, y, detail FROM audit_log ORDER BY id')
        .all(),
    ).toEqual([
      {
        robot_id: 2,
        event_code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        x: 30,
        y: 40,
        detail: '{"note":"x"}',
      },
      { robot_id: 1, event_code: 'RECOVER_NOOP', state: 'IDLE', x: null, y: null, detail: null },
    ]);
  });

  it('record sin robot ni estado solo se admite en los dos rechazos del alta (trigger)', () => {
    const repo = createAuditLogRepository(createTestDb());
    expect(() =>
      repo.record({ robotId: null, eventCode: 'BUSY', state: null, position: { x: 1, y: 1 } }),
    ).toThrow(/requires robot_id and state/);
    expect(() =>
      repo.record({
        robotId: null,
        eventCode: 'ROBOT_START_IN_RESTRICTED_ZONE',
        state: null,
        position: { x: 1, y: 1 },
        detail: { name: 'N', type: 'GUARD' },
      }),
    ).not.toThrow();
  });

  it('findAll devuelve fechas ISO también para las filas antiguas (UTC)', () => {
    const db = createDbBefore('011');
    db.prepare(
      "INSERT INTO audit_log (event_code, state, dest_x, dest_y, created_at) VALUES ('BUSY', 'MOVING', 9, 10, '2025-03-04 05:06:07')",
    ).run();
    migrate(db);
    const repo = createAuditLogRepository(db);
    repo.record({ robotId: 1, eventCode: 'BUSY', state: 'MOVING', position: { x: 1, y: 2 } });

    const rows = repo.findAll();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      robotId: null,
      eventCode: 'BUSY',
      state: 'MOVING',
      x: 9,
      y: 10,
      detail: null,
      createdAt: '2025-03-04T05:06:07.000Z',
    });
    expect(rows[1]?.robotId).toBe(1);
    expect(rows[1]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
