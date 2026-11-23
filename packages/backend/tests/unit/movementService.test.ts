import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@home-guardian/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { AppError } from '../../src/errors/AppError.js';
import { createMovementLogRepository } from '../../src/repositories/movementLogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { assertDestinationWithinFloor } from '../../src/services/floorBounds.js';
import { createMovementService, type MovementService } from '../../src/services/movementService.js';
import { createTestDb, readMovementLog } from '../helpers.js';

// Spec 003 — tarea 20. Habitaciones del prototipo; robot inicial en (120, 90), Sala.
function build(db: Db, overrides: { getActiveZones?: () => never } = {}): MovementService {
  const zones = createZoneRepository(db);
  return createMovementService({
    robots: createRobotRepository(db),
    movementLog: createMovementLogRepository(db),
    getActiveZones: overrides.getActiveZones ?? (() => zones.findAll('active')),
    runInTransaction: (fn) => db.transaction(fn)(),
    pad: 0,
  });
}

function expectOutOfBounds(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      status: 422,
      code: 'DESTINATION_OUT_OF_BOUNDS',
    });
    return;
  }
  throw new Error('Se esperaba DESTINATION_OUT_OF_BOUNDS');
}

describe('movementService', () => {
  let db: Db;
  let service: MovementService;
  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    service = build(db);
  });

  describe('CA-03.5 límites del plano (RF-01.4, RF-01.5)', () => {
    it.each([
      [-0.1, 10],
      [10, -1],
      [FLOOR_WIDTH + 0.01, 10],
      [10, FLOOR_HEIGHT + 1],
    ])('(%d, %d) fuera del plano → 422 y el robot no cambia ni se registra', (x, y) => {
      expectOutOfBounds(() => service.move({ x, y }));
      expect(service.getRobot()).toEqual({
        state: 'IDLE',
        position: { x: 120, y: 90 },
      });
      expect(readMovementLog(db)).toEqual([]);
    });

    it.each([
      [0, 0],
      [FLOOR_WIDTH, 0],
      [0, FLOOR_HEIGHT],
      [FLOOR_WIDTH, FLOOR_HEIGHT],
    ])('el borde (%d, %d) es válido (inclusivo)', (x, y) => {
      expect(() => assertDestinationWithinFloor({ x, y })).not.toThrow();
    });
  });

  it('CA-03.1 ALLOW: persiste la nueva posición en IDLE y responde MOVING', () => {
    const result = service.move({ x: 450, y: 120 });
    expect(result).toMatchObject({
      decision: 'ALLOW',
      state: 'MOVING',
      position: { x: 450, y: 120 },
    });
    expect(service.getRobot()).toEqual({
      state: 'IDLE',
      position: { x: 450, y: 120 },
    });
  });

  it('CA-03.2 PREVENTIVE_STOP: persiste SAFE_STOP y conserva la posición', () => {
    const result = service.move({ x: 100, y: 300 });
    expect(result).toMatchObject({
      decision: 'PREVENTIVE_STOP',
      zoneName: 'Escaleras',
    });
    expect(service.getRobot()).toEqual({
      state: 'SAFE_STOP',
      position: { x: 120, y: 90 },
    });
  });

  it('CA-03.4 DENIED_SAFE_STOP: no cambia estado ni posición', () => {
    service.move({ x: 100, y: 300 });
    const result = service.move({ x: 450, y: 120 });
    expect(result).toMatchObject({
      decision: 'DENIED_SAFE_STOP',
      code: 'SAFE_STOP_ACTIVE',
    });
    expect(service.getRobot()).toEqual({
      state: 'SAFE_STOP',
      position: { x: 120, y: 90 },
    });
  });

  it('usa las zonas activas vigentes: desactivar la zona permite el mismo movimiento', () => {
    createZoneRepository(db).update(3, {
      name: 'Escaleras',
      x: 29,
      y: 226,
      width: 160,
      height: 178,
      active: false,
    });
    expect(service.move({ x: 100, y: 300 }).decision).toBe('ALLOW');
  });

  it('CA-03.8 registra cada evaluación (incluida la denegación) con su causa', () => {
    service.move({ x: 450, y: 120 });
    service.move({ x: 100, y: 600 });
    service.move({ x: 500, y: 500 });
    expect(readMovementLog(db)).toEqual([
      expect.objectContaining({
        decision: 'ALLOW',
        state_after: 'MOVING',
        origin_x: 120,
        origin_y: 90,
        dest_x: 450,
        dest_y: 120,
        collision_type: null,
      }),
      expect.objectContaining({
        decision: 'PREVENTIVE_STOP',
        state_after: 'SAFE_STOP',
        origin_x: 450,
        origin_y: 120,
        dest_x: 100,
        dest_y: 600,
        collision_type: 'TRAJECTORY_CROSSES_ZONE',
      }),
      expect.objectContaining({
        decision: 'DENIED_SAFE_STOP',
        state_after: 'SAFE_STOP',
        origin_x: 450,
        origin_y: 120,
      }),
    ]);
  });

  it('es atómico: si falla la evaluación no se persiste estado ni registro', () => {
    const failing = build(db, {
      getActiveZones: () => {
        throw new Error('boom');
      },
    });
    expect(() => failing.move({ x: 450, y: 120 })).toThrow('boom');
    expect(service.getRobot()).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
    });
    expect(readMovementLog(db)).toEqual([]);
  });

  describe('reset (DD-106)', () => {
    it('SAFE_STOP → IDLE conservando la posición', () => {
      service.move({ x: 100, y: 300 });
      expect(service.reset()).toEqual({
        state: 'IDLE',
        position: { x: 120, y: 90 },
      });
      expect(service.getRobot().state).toBe('IDLE');
      expect(service.move({ x: 450, y: 120 }).decision).toBe('ALLOW');
    });

    it('en IDLE es idempotente', () => {
      expect(service.reset()).toEqual({
        state: 'IDLE',
        position: { x: 120, y: 90 },
      });
    });
  });

  it.each([
    [0, 'ALLOW'],
    [10, 'PREVENTIVE_STOP'],
  ])('la regla recibe el pad configurado (pad=%d → %s)', (pad, decision) => {
    // Pasillo x=195 entre Escaleras (x máx 189) y Cuarto del bebé (x mín 206).
    const robots = createRobotRepository(db);
    robots.save({ state: 'IDLE', position: { x: 195, y: 90 } });
    const zones = createZoneRepository(db);
    const getActiveZones = vi.fn(() => zones.findAll('active'));
    const padded = createMovementService({
      robots,
      movementLog: createMovementLogRepository(db),
      getActiveZones,
      runInTransaction: (fn) => fn(),
      pad,
    });
    expect(padded.move({ x: 195, y: 300 }).decision).toBe(decision);
    expect(getActiveZones).toHaveBeenCalledOnce();
  });
});
