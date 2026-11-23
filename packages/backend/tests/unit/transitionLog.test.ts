import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createDbBefore, createTestDb } from '../helpers.js';

// Spec 002 — RC-7 (R9.1, R9.7, R9.8, R5.9): 010_create_state_transition_log.sql

const INSERT = `INSERT INTO state_transition_log (robot_id, from_state, to_state, cause)
                VALUES (?, ?, ?, ?)`;

describe('010_create_state_transition_log.sql', () => {
  it('inserta una fila base MIGRATION_BASELINE por robot existente (A1 y V2)', () => {
    const rows = createTestDb()
      .prepare('SELECT robot_id, from_state, to_state, cause FROM state_transition_log ORDER BY id')
      .all();
    expect(rows).toEqual([
      { robot_id: 1, from_state: null, to_state: 'IDLE', cause: 'MIGRATION_BASELINE' },
      { robot_id: 2, from_state: null, to_state: 'IDLE', cause: 'MIGRATION_BASELINE' },
    ]);
  });

  it('la fila base refleja el estado persistido en el momento de la migración', () => {
    const db = createDbBefore('010');
    db.prepare("UPDATE robot_state SET state = 'SAFE_STOP' WHERE robot_id = 1").run();
    migrate(db);
    expect(
      db.prepare('SELECT to_state FROM state_transition_log WHERE robot_id = 1').all(),
    ).toEqual([{ to_state: 'SAFE_STOP' }]);
  });

  it('from_state NULL solo con ROBOT_REGISTERED o MIGRATION_BASELINE', () => {
    const db = createTestDb();
    const robot = db.prepare("INSERT INTO robots (name, type) VALUES ('R3', 'GUARD')").run();
    const id = Number(robot.lastInsertRowid);
    expect(() => db.prepare(INSERT).run(id, null, 'IDLE', 'AUTHORIZED')).toThrow(/CHECK/);
    expect(() => db.prepare(INSERT).run(id, null, 'IDLE', 'ROBOT_REGISTERED')).not.toThrow();
    expect(() => db.prepare(INSERT).run(id, null, 'IDLE', 'MIGRATION_BASELINE')).not.toThrow();
  });

  it('valida estados, causa y robot', () => {
    const db = createTestDb();
    expect(() => db.prepare(INSERT).run(1, 'IDLE', 'TELEPORT', 'AUTHORIZED')).toThrow(/CHECK/);
    expect(() => db.prepare(INSERT).run(1, 'TELEPORT', 'IDLE', 'AUTHORIZED')).toThrow(/CHECK/);
    expect(() => db.prepare(INSERT).run(1, 'IDLE', 'MOVING', 'NOT_A_CAUSE')).toThrow(/CHECK/);
    expect(() => db.prepare(INSERT).run(99, 'IDLE', 'MOVING', 'AUTHORIZED')).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(INSERT).run(1, 'IDLE', 'MOVING', 'AUTHORIZED')).not.toThrow();
  });

  it('es append-only', () => {
    const db = createTestDb();
    expect(() => db.prepare('UPDATE state_transition_log SET cause = ?').run('AUTHORIZED')).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM state_transition_log').run()).toThrow(/append-only/);
  });
});

describe('transitionLogRepository', () => {
  it('append registra la transición y findByRobot la devuelve en orden con fecha ISO', () => {
    const repo = createTransitionLogRepository(createTestDb());
    repo.append({
      robotId: 1,
      fromState: 'IDLE',
      toState: 'MOVING',
      cause: 'AUTHORIZED',
      detail: { destination: { x: 5, y: 6 }, sequence: 1 },
    });
    repo.append({ robotId: 1, fromState: 'MOVING', toState: 'IDLE', cause: 'MOVE_COMPLETED' });
    repo.append({
      robotId: 2,
      fromState: 'IDLE',
      toState: 'SAFE_STOP',
      cause: 'ZONE_DATA_UNAVAILABLE',
    });

    const rows = repo.findByRobot(1);
    expect(rows.map((r) => [r.fromState, r.toState, r.cause])).toEqual([
      [null, 'IDLE', 'MIGRATION_BASELINE'],
      ['IDLE', 'MOVING', 'AUTHORIZED'],
      ['MOVING', 'IDLE', 'MOVE_COMPLETED'],
    ]);
    expect(rows[1]?.detail).toEqual({ destination: { x: 5, y: 6 }, sequence: 1 });
    expect(rows[2]?.detail).toBeNull();
    expect(rows[1]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(repo.findByRobot(2)).toHaveLength(2);
  });

  it('un append inválido lanza y no escribe', () => {
    const repo = createTransitionLogRepository(createTestDb());
    expect(() =>
      repo.append({ robotId: 99, fromState: 'IDLE', toState: 'MOVING', cause: 'AUTHORIZED' }),
    ).toThrow();
    expect(repo.findByRobot(99)).toEqual([]);
  });
});
