import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTestDb, readMovementLog } from '../helpers.js';

// Spec 003 — tareas 3, 4, 5, 6 (adaptadas en spec 002 RC-20: la fila única de A1 se lee y se
// escribe con los métodos por robot)
describe('robotRepository (RF-02.1, DD-103)', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('una base nueva tiene el robot en IDLE en la posición inicial', () => {
    expect(createRobotRepository(db).getStatus(1)).toMatchObject({
      state: 'IDLE',
      position: { x: 120, y: 90 },
    });
  });

  it('saveState actualiza estado y posición solo de A1 (robot_id = 1)', () => {
    const repo = createRobotRepository(db);
    repo.saveState(1, 'SAFE_STOP', { x: 300.5, y: 42 });
    expect(repo.getStatus(1)).toMatchObject({
      state: 'SAFE_STOP',
      position: { x: 300.5, y: 42 },
    });
    // Spec 002 RC-5: V2 (robot_id = 2) conserva su fila base intacta.
    expect(
      db.prepare('SELECT state, pos_x, pos_y FROM robot_state WHERE robot_id = 2').get(),
    ).toEqual({ state: 'IDLE', pos_x: 488, pos_y: 290 });
  });

  it('la tabla es por robot: exige un robot existente y solo admite estados en alcance', () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO robot_state (robot_id, state, pos_x, pos_y, position_quality) VALUES (99, 'IDLE', 0, 0, 'RELIABLE')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    // El CHECK se amplió en la spec 002 (migración 005) con DEGRADED/RECOVERING; un estado
    // fuera del alcance sigue rechazándose.
    expect(() => db.prepare("UPDATE robot_state SET state = 'TELEPORT'").run()).toThrow();
  });
});

// Spec 002 — tarea 8: lectura/escritura de position_quality (migración 005)
describe('robotRepository positionQuality (spec 002, §4, R6)', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('R6.1 el robot sembrado tiene positionQuality RELIABLE', () => {
    expect(createRobotRepository(db).getStatus(1)).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
  });

  it('saveQuality persiste la calidad sin tocar estado ni posición', () => {
    const repo = createRobotRepository(db);
    repo.saveQuality(1, 'MISSING');
    expect(repo.getStatus(1)).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'MISSING',
    });
  });

  it('saveState persiste el estado ampliado (DEGRADED) y la posición; saveQuality, la calidad', () => {
    const repo = createRobotRepository(db);
    repo.saveState(1, 'DEGRADED', { x: 55.5, y: 12 });
    repo.saveQuality(1, 'UNRELIABLE');
    expect(repo.getStatus(1)).toEqual({
      robotId: 1,
      state: 'DEGRADED',
      position: { x: 55.5, y: 12 },
      positionQuality: 'UNRELIABLE',
    });
  });

  it('saveState conserva la positionQuality vigente', () => {
    const repo = createRobotRepository(db);
    repo.saveQuality(1, 'MISSING');
    repo.saveState(1, 'SAFE_STOP', { x: 300, y: 42 });
    expect(repo.getStatus(1)).toEqual({
      robotId: 1,
      state: 'SAFE_STOP',
      position: { x: 300, y: 42 },
      positionQuality: 'MISSING',
    });
  });
});

// `movement_log` (spec 003) se conserva como histórico inmutable que ya no recibe filas (spec 002
// R9, design §4): el repositorio que la escribía se retiró en RC-20, y la tabla conserva su
// garantía append-only (RF-05.2, DD-105), que se prueba con inserciones directas.
describe('movement_log — histórico append-only (RF-05.2, DD-105)', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const insert = () =>
    db
      .prepare(
        `INSERT INTO movement_log
           (decision, state_after, origin_x, origin_y, dest_x, dest_y, collision_type, zone_name, reason)
         VALUES ('PREVENTIVE_STOP', 'SAFE_STOP', 120, 90, 100, 500, 'TRAJECTORY_CROSSES_ZONE',
                 'Escaleras', 'Trajectory crosses restricted zone: Escaleras')`,
      )
      .run();

  it('la base nueva conserva la tabla vacía y admite el esquema original', () => {
    expect(readMovementLog(db)).toEqual([]);
    insert();
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

  it('el registro es inmutable: la base rechaza UPDATE y DELETE', () => {
    insert();
    expect(() => db.prepare("UPDATE movement_log SET decision = 'ALLOW'").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM movement_log').run()).toThrow(/append-only/);
    expect(readMovementLog(db)).toHaveLength(1);
  });
});

// Spec 002 — RC-10 (N-6): métodos por robot de robotRepository
describe('robotRepository por robot (spec 002 RC-10)', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('getStatus devuelve el estado de cada robot y null si no existe', () => {
    const repo = createRobotRepository(db);
    expect(repo.getStatus(1)).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
    expect(repo.getStatus(2)).toEqual({
      robotId: 2,
      state: 'IDLE',
      position: { x: 488, y: 290 },
      positionQuality: 'RELIABLE',
    });
    expect(repo.getStatus(99)).toBeNull();
  });

  it('findAll devuelve todos los robots ordenados por id', () => {
    expect(
      createRobotRepository(db)
        .findAll()
        .map((r) => r.robotId),
    ).toEqual([1, 2]);
  });

  it('saveState y saveQuality solo tocan al robot indicado', () => {
    const repo = createRobotRepository(db);
    repo.saveState(2, 'SAFE_STOP', { x: 10, y: 20 });
    repo.saveQuality(2, 'MISSING');
    expect(repo.getStatus(2)).toEqual({
      robotId: 2,
      state: 'SAFE_STOP',
      position: { x: 10, y: 20 },
      positionQuality: 'MISSING',
    });
    expect(repo.getStatus(1)).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
  });
});

// Spec 002 — RC-11 (hallazgo menor del revisor): escribir el estado o la calidad de un robot sin
// fila es un error de programación y lanza, en vez de no hacer nada en silencio.
describe('robotRepository.saveState / saveQuality ante un robot sin fila', () => {
  it('saveState lanza si no actualiza ninguna fila', () => {
    const repo = createRobotRepository(createTestDb());
    expect(() => repo.saveState(99, 'IDLE', { x: 1, y: 1 })).toThrow(/robot 99/);
  });

  it('saveQuality lanza si no actualiza ninguna fila', () => {
    const repo = createRobotRepository(createTestDb());
    expect(() => repo.saveQuality(99, 'MISSING')).toThrow(/robot 99/);
  });

  it('con una fila existente siguen funcionando', () => {
    const repo = createRobotRepository(createTestDb());
    repo.saveState(2, 'SAFE_STOP', { x: 5, y: 6 });
    repo.saveQuality(2, 'UNRELIABLE');
    expect(repo.getStatus(2)).toEqual({
      robotId: 2,
      state: 'SAFE_STOP',
      position: { x: 5, y: 6 },
      positionQuality: 'UNRELIABLE',
    });
  });
});
