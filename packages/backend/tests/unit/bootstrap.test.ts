import { describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/db/bootstrap.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createTestDb, getRobotState, setRobotState } from '../helpers.js';

describe('reinicio seguro del robot (ADR-10, R6)', () => {
  it('preserva el seed: estado IDLE y positionQuality RELIABLE (R6.1, R6.4 — no fuerza MISSING)', () => {
    const db = createTestDb();
    // La fila sembrada (migración 002 + 005) arranca en IDLE con posición confiable.
    expect(getRobotState(db, 1)).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });

    bootstrap(db);

    expect(getRobotState(db, 1)).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
  });

  it('degrada un MOVING persistido a SAFE_STOP conservando posición y calidad (R6.3)', () => {
    const db = createTestDb();
    setRobotState(db, 1, {
      state: 'MOVING',
      position: { x: 42, y: 17 },
      positionQuality: 'RELIABLE',
    });

    bootstrap(db);

    expect(getRobotState(db, 1)).toEqual({
      state: 'SAFE_STOP',
      position: { x: 42, y: 17 },
      positionQuality: 'RELIABLE',
    });
  });

  it('no altera un positionQuality MISSING persistido por una señal de pérdida previa (R6.4)', () => {
    const db = createTestDb();
    // Simula una señal de pérdida explícita previa: estado no-MOVING con calidad MISSING.
    setRobotState(db, 1, {
      state: 'DEGRADED',
      position: { x: 10, y: 20 },
      positionQuality: 'MISSING',
    });

    bootstrap(db);

    expect(getRobotState(db, 1)).toEqual({
      state: 'DEGRADED',
      position: { x: 10, y: 20 },
      positionQuality: 'MISSING',
    });
  });

  it('es idempotente: ejecutarla dos veces deja el mismo resultado (SAFE_STOP estable)', () => {
    const db = createTestDb();
    setRobotState(db, 1, {
      state: 'MOVING',
      position: { x: 5, y: 6 },
      positionQuality: 'UNRELIABLE',
    });

    bootstrap(db);
    const afterFirst = getRobotState(db, 1);
    bootstrap(db);
    const afterSecond = getRobotState(db, 1);

    expect(afterFirst).toEqual({
      state: 'SAFE_STOP',
      position: { x: 5, y: 6 },
      positionQuality: 'UNRELIABLE',
    });
    expect(afterSecond).toEqual(afterFirst);
  });

  // Spec 002 — RC-10 (R6.5, R9.4): T8 y arranque seguro de todos los robots.
  it('registra T8 (BOOTSTRAP_MOVING_PERSISTED) al degradar un MOVING persistido', () => {
    const db = createTestDb();
    const robots = createRobotRepository(db);
    robots.saveState(1, 'MOVING', { x: 42, y: 17 });

    bootstrap(db);

    const rows = createTransitionLogRepository(db)
      .findByRobot(1)
      .map((r) => [r.fromState, r.toState, r.cause]);
    expect(rows).toEqual([
      [null, 'IDLE', 'MIGRATION_BASELINE'],
      ['MOVING', 'SAFE_STOP', 'BOOTSTRAP_MOVING_PERSISTED'],
    ]);
  });

  it('con dos robots, solo el que tiene MOVING sembrado pasa a SAFE_STOP con T8', () => {
    const db = createTestDb();
    const robots = createRobotRepository(db);
    const log = createTransitionLogRepository(db);
    robots.saveState(2, 'MOVING', { x: 300, y: 300 });

    bootstrap(db);

    expect(robots.getStatus(1)?.state).toBe('IDLE');
    expect(robots.getStatus(2)).toEqual({
      robotId: 2,
      state: 'SAFE_STOP',
      position: { x: 300, y: 300 },
      positionQuality: 'RELIABLE',
    });
    expect(log.findByRobot(1)).toHaveLength(1);
    expect(log.findByRobot(2).map((r) => r.cause)).toEqual([
      'MIGRATION_BASELINE',
      'BOOTSTRAP_MOVING_PERSISTED',
    ]);

    bootstrap(db); // idempotente: no añade filas
    expect(log.findByRobot(2)).toHaveLength(2);
  });
});
