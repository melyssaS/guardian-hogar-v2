import type { MoveResult } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { createMovementLogRepository } from '../../src/repositories/movementLogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTestDb, readMovementLog } from '../helpers.js';

// Spec 003 — tareas 3, 4, 5, 6
describe('robotRepository (RF-02.1, DD-103)', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('una base nueva tiene el robot en IDLE en la posición inicial', () => {
    expect(createRobotRepository(db).get()).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
    });
  });

  it('save actualiza estado y posición de la fila única', () => {
    const repo = createRobotRepository(db);
    repo.save({ state: 'SAFE_STOP', position: { x: 300.5, y: 42 } });
    expect(repo.get()).toEqual({
      state: 'SAFE_STOP',
      position: { x: 300.5, y: 42 },
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM robot_state').get()).toEqual({
      n: 1,
    });
  });

  it('la tabla es singleton y solo admite estados en alcance', () => {
    expect(() =>
      db.prepare("INSERT INTO robot_state (id, state) VALUES (2, 'IDLE')").run(),
    ).toThrow();
    // El CHECK se amplió en la spec 002 (migración 005) con DEGRADED/RECOVERING; un estado
    // fuera del alcance sigue rechazándose.
    expect(() => db.prepare("UPDATE robot_state SET state = 'TELEPORT'").run()).toThrow();
  });
});

// Spec 002 — tarea 8: lectura/escritura de position_quality y snapshot completo (migración 005)
describe('robotRepository positionQuality (spec 002, §4, R6)', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('R6.1 el robot sembrado tiene positionQuality RELIABLE', () => {
    const repo = createRobotRepository(db);
    expect(repo.getPositionQuality()).toBe('RELIABLE');
    expect(repo.getFull()).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
  });

  it('setPositionQuality persiste la calidad sin tocar estado ni posición', () => {
    const repo = createRobotRepository(db);
    repo.setPositionQuality('MISSING');
    expect(repo.getFull()).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'MISSING',
    });
  });

  it('saveFull persiste estado ampliado (DEGRADED), posición y calidad a la vez', () => {
    const repo = createRobotRepository(db);
    repo.saveFull({
      state: 'DEGRADED',
      position: { x: 55.5, y: 12 },
      positionQuality: 'UNRELIABLE',
    });
    expect(repo.getFull()).toEqual({
      state: 'DEGRADED',
      position: { x: 55.5, y: 12 },
      positionQuality: 'UNRELIABLE',
    });
  });

  it('save (spec 003) conserva la positionQuality vigente', () => {
    const repo = createRobotRepository(db);
    repo.setPositionQuality('MISSING');
    repo.save({ state: 'SAFE_STOP', position: { x: 300, y: 42 } });
    expect(repo.getFull()).toEqual({
      state: 'SAFE_STOP',
      position: { x: 300, y: 42 },
      positionQuality: 'MISSING',
    });
  });
});

describe('movementLogRepository (RF-05, DD-105)', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const stop: MoveResult = {
    decision: 'PREVENTIVE_STOP',
    state: 'SAFE_STOP',
    position: { x: 120, y: 90 },
    collisionType: 'TRAJECTORY_CROSSES_ZONE',
    zoneName: 'Escaleras',
    reason: 'Trajectory crosses restricted zone: Escaleras',
  };

  it('CA-03.8 inserta decisión, causa, origen, destino y estado resultante', () => {
    createMovementLogRepository(db).append({
      origin: { x: 120, y: 90 },
      destination: { x: 100, y: 500 },
      result: stop,
    });
    expect(readMovementLog(db)).toEqual([
      {
        decision: 'PREVENTIVE_STOP',
        state_after: 'SAFE_STOP',
        origin_x: 120,
        origin_y: 90,
        dest_x: 100,
        dest_y: 500,
        collision_type: 'TRAJECTORY_CROSSES_ZONE',
        zone_name: 'Escaleras',
        reason: 'Trajectory crosses restricted zone: Escaleras',
      },
    ]);
  });

  it('guarda NULL en la causa cuando no hay colisión', () => {
    createMovementLogRepository(db).append({
      origin: { x: 0, y: 0 },
      destination: { x: 1, y: 1 },
      result: {
        decision: 'ALLOW',
        state: 'MOVING',
        position: { x: 1, y: 1 },
        reason: 'ok',
      },
    });
    expect(readMovementLog(db)[0]).toMatchObject({
      collision_type: null,
      zone_name: null,
    });
  });

  it('RF-05.2 el registro es inmutable: la base rechaza UPDATE y DELETE', () => {
    createMovementLogRepository(db).append({
      origin: { x: 0, y: 0 },
      destination: { x: 1, y: 1 },
      result: stop,
    });
    expect(() => db.prepare("UPDATE movement_log SET decision = 'ALLOW'").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM movement_log').run()).toThrow(/append-only/);
    expect(readMovementLog(db)).toHaveLength(1);
  });
});
