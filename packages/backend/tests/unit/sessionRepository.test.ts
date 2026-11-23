import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import { createSessionRepository } from '../../src/repositories/sessionRepository.js';
import { createDbBefore, createTestDb } from '../helpers.js';

// Spec 003 — RC-3b (RF-07.6, RF-08.5, CA-03.19, DD-122, DD-124): 012_create_robot_sessions.sql

const S1 = '5f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const S2 = '6a2d3c4b-5e6f-4071-9b8c-0d1e2f3a4b5c';
const S3 = '7b3e4d5c-6f70-4182-8c9d-1e2f3a4b5c6d';

describe('012_create_robot_sessions.sql', () => {
  it('se aplica después de la 011 y registra su versión', () => {
    const db = createTestDb();
    const versions = (
      db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: string;
      }>
    ).map((r) => r.version);
    expect(versions.indexOf('012_create_robot_sessions.sql')).toBeGreaterThan(
      versions.indexOf('011_audit_log_generalize.sql'),
    );
  });

  it('no se aplica sobre una base que ya tiene aplicada una posterior (orden endurecido)', () => {
    const db = createDbBefore('012');
    expect(migrate(db)).toEqual(['012_create_robot_sessions.sql']);
  });

  it('define el esquema único: una fila por robot, session_id UNIQUE, last_sequence 0 por defecto', () => {
    const db = createTestDb();
    const insert = db.prepare('INSERT INTO robot_sessions (robot_id, session_id) VALUES (?, ?)');
    insert.run(1, S1);
    expect(
      db
        .prepare(
          'SELECT last_sequence, last_destination_x, last_destination_y, last_accepted_at, started_at FROM robot_sessions WHERE robot_id = 1',
        )
        .get(),
    ).toEqual({
      last_sequence: 0,
      last_destination_x: null,
      last_destination_y: null,
      last_accepted_at: null,
      started_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(() => insert.run(1, S2)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => insert.run(2, S1)).toThrow(/UNIQUE/);
    expect(() => insert.run(99, S3)).toThrow(/FOREIGN KEY/);
  });

  it('session_id y last_sequence no admiten NULL', () => {
    const db = createTestDb();
    expect(() =>
      db.prepare('INSERT INTO robot_sessions (robot_id, session_id) VALUES (1, NULL)').run(),
    ).toThrow(/NOT NULL/);
    expect(() =>
      db
        .prepare(
          'INSERT INTO robot_sessions (robot_id, session_id, last_sequence) VALUES (1, ?, NULL)',
        )
        .run(S1),
    ).toThrow(/NOT NULL/);
  });

  it('A1 conserva la fila de una base existente y V2 se crea en (488, 290)', () => {
    const db = createDbBefore('008');
    db.prepare('UPDATE robot_state SET pos_x = 11, pos_y = 22 WHERE id = 1').run();
    migrate(db);
    expect(
      db.prepare('SELECT robot_id, pos_x, pos_y FROM robot_state ORDER BY robot_id').all(),
    ).toEqual([
      { robot_id: 1, pos_x: 11, pos_y: 22 },
      { robot_id: 2, pos_x: 488, pos_y: 290 },
    ]);
  });

  it('en una base nueva A1 queda en (120, 90) y V2 en (488, 290)', () => {
    expect(
      createTestDb()
        .prepare('SELECT robot_id, pos_x, pos_y FROM robot_state ORDER BY robot_id')
        .all(),
    ).toEqual([
      { robot_id: 1, pos_x: 120, pos_y: 90 },
      { robot_id: 2, pos_x: 488, pos_y: 290 },
    ]);
  });
});

describe('sessionRepository', () => {
  it('sin sesión: findLastRequest y findSessionId devuelven null', () => {
    const repo = createSessionRepository(createTestDb());
    expect(repo.findSessionId(1)).toBeNull();
    expect(repo.findLastRequest(1)).toBeNull();
  });

  it('replaceSession crea la sesión vigente sin solicitudes aceptadas', () => {
    const repo = createSessionRepository(createTestDb());
    repo.replaceSession(1, S1);
    expect(repo.findSessionId(1)).toBe(S1);
    expect(repo.findLastSequence(1)).toBe(0);
    expect(repo.findLastRequest(1)).toBeNull();
  });

  it('recordAccepted guarda secuencia, destino y fecha ISO; findLastRequest la reconstruye', () => {
    const repo = createSessionRepository(createTestDb());
    repo.replaceSession(1, S1);
    repo.recordAccepted(1, 3, { x: 250.5, y: 175 });
    expect(repo.findLastSequence(1)).toBe(3);
    expect(repo.findLastRequest(1)).toEqual({
      sessionId: S1,
      sequence: 3,
      destination: { x: 250.5, y: 175 },
      acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('una sesión nueva sustituye a la anterior y reinicia la última solicitud', () => {
    const repo = createSessionRepository(createTestDb());
    repo.replaceSession(1, S1);
    repo.recordAccepted(1, 2, { x: 1, y: 2 });
    repo.replaceSession(1, S2);
    expect(repo.findSessionId(1)).toBe(S2);
    expect(repo.findLastSequence(1)).toBe(0);
    expect(repo.findLastRequest(1)).toBeNull();
  });

  it('las sesiones son independientes por robot', () => {
    const repo = createSessionRepository(createTestDb());
    repo.replaceSession(1, S1);
    repo.replaceSession(2, S2);
    repo.recordAccepted(1, 5, { x: 1, y: 1 });
    expect(repo.findLastSequence(2)).toBe(0);
    expect(repo.findSessionId(2)).toBe(S2);
  });

  it('recordAccepted sobre un robot sin sesión lanza', () => {
    const repo = createSessionRepository(createTestDb());
    expect(() => repo.recordAccepted(1, 1, { x: 1, y: 1 })).toThrow(/no session/);
  });
});
