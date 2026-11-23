import type { Point, RobotStateName, Zone } from '@home-guardian/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import {
  createRobotRepository,
  type RobotRepository,
} from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createTestDb, createTestGuardian, type TestGuardian } from '../helpers.js';

// Spec 002 — RC-10 (R9.1–R9.8, R6.5, R4.6): helper `transition` y Property 11 por robot.
// Robots sembrados: A1 (1) IDLE en (120, 90) y V2 (2) IDLE en (488, 290), ambos RELIABLE.

const FREE: Point = { x: 450, y: 120 };
const IN_STAIRS: Point = { x: 100, y: 300 };

interface Harness {
  db: Db;
  robots: RobotRepository;
  service: TestGuardian;
  zones: () => Zone[];
  rows: (robotId: number) => Array<[string | null, string, string]>;
  details: (robotId: number) => Array<Record<string, unknown> | null>;
}

function build(opts: { getActiveZones?: () => Zone[] } = {}): Harness {
  const db = createTestDb();
  seedDefaultRooms(db);
  const zoneRepo = createZoneRepository(db);
  const robots = createRobotRepository(db);
  const transitions = createTransitionLogRepository(db);
  const getActiveZones = opts.getActiveZones ?? (() => zoneRepo.findAll('active'));
  const service = createTestGuardian(db, {
    robots,
    incidents: createIncidentRepository(db),
    audit: createAuditLogRepository(db),
    transitions,
    getActiveZones,
    runInTransaction: (fn) => db.transaction(fn)(),
    pad: 0,
  });
  return {
    db,
    robots,
    service,
    zones: () => zoneRepo.findAll('active'),
    rows: (id) => transitions.findByRobot(id).map((r) => [r.fromState, r.toState, r.cause]),
    details: (id) => transitions.findByRobot(id).map((r) => r.detail),
  };
}

const BASELINE: [null, RobotStateName, string] = [null, 'IDLE', 'MIGRATION_BASELINE'];

describe('Property 11 por robot — filas exactas de state_transition_log', () => {
  let h: Harness;
  beforeEach(() => {
    h = build();
  });

  it('move autorizado: T1 (con MOVING persistido) + T2, con el destino en detail', () => {
    const saved: RobotStateName[] = [];
    const original = h.robots.saveState.bind(h.robots);
    vi.spyOn(h.robots, 'saveState').mockImplementation((robotId, state, position) => {
      saved.push(state);
      original(robotId, state, position);
    });

    h.service.move(1, FREE);

    expect(saved).toEqual(['MOVING', 'IDLE']);
    expect(h.rows(1)).toEqual([
      BASELINE,
      ['IDLE', 'MOVING', 'AUTHORIZED'],
      ['MOVING', 'IDLE', 'MOVE_COMPLETED'],
    ]);
    expect(h.details(1)[1]).toEqual({
      destination: FREE,
      sessionId: expect.any(String),
      sequence: 1,
    });
    expect(h.robots.getStatus(1)).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: FREE,
      positionQuality: 'RELIABLE',
    });
  });

  it('denegación geométrica desde IDLE: T3 con la causa y el incidentId', () => {
    h.service.move(1, IN_STAIRS);

    expect(h.rows(1)).toEqual([BASELINE, ['IDLE', 'SAFE_STOP', 'RESTRICTED_ZONE_VIOLATION']]);
    const incidentId = (h.db.prepare('SELECT id FROM incidents').get() as { id: number }).id;
    expect(h.details(1)[1]).toEqual({ incidentId });
  });

  it('denegación por datos: T4 (MISSING_POSITION / INSUFFICIENT_DATA) a DEGRADED', () => {
    h.robots.saveQuality(1, 'MISSING');
    h.service.move(1, FREE);
    expect(h.rows(1)[1]).toEqual(['IDLE', 'DEGRADED', 'MISSING_POSITION']);

    h.robots.saveQuality(2, 'UNRELIABLE');
    h.service.move(2, FREE);
    expect(h.rows(2)[1]).toEqual(['IDLE', 'DEGRADED', 'INSUFFICIENT_DATA']);
  });

  it('zonas no disponibles: T3 con ZONE_DATA_UNAVAILABLE', () => {
    const failing = build({
      getActiveZones: () => {
        throw new Error('zones down');
      },
    });
    failing.service.move(1, FREE);
    expect(failing.rows(1)[1]).toEqual(['IDLE', 'SAFE_STOP', 'ZONE_DATA_UNAVAILABLE']);
  });

  it('recover desde SAFE_STOP: T6 + T7 con el snapshot de zonas en T7', () => {
    h.service.move(1, IN_STAIRS);
    h.service.recover(1);

    expect(h.rows(1)).toEqual([
      BASELINE,
      ['IDLE', 'SAFE_STOP', 'RESTRICTED_ZONE_VIOLATION'],
      ['SAFE_STOP', 'RECOVERING', 'RECOVER_REQUESTED'],
      ['RECOVERING', 'IDLE', 'RECOVER_COMPLETED'],
    ]);
    const snapshot = (h.details(1)[3] as { zonesSnapshot: Zone[] }).zonesSnapshot;
    expect(snapshot).toEqual(h.zones());
    expect(h.robots.getStatus(1)?.state).toBe('IDLE');
  });

  it('recover desde DEGRADED también registra T6 + T7', () => {
    h.robots.saveQuality(1, 'MISSING');
    h.service.move(1, FREE); // → DEGRADED
    h.robots.saveQuality(1, 'RELIABLE');
    h.service.recover(1);
    expect(h.rows(1).slice(2)).toEqual([
      ['DEGRADED', 'RECOVERING', 'RECOVER_REQUESTED'],
      ['RECOVERING', 'IDLE', 'RECOVER_COMPLETED'],
    ]);
  });

  it('los rechazos no escriben filas (SAFE_STOP_ACTIVE, BUSY, recover rechazado o sin efecto)', () => {
    h.service.recover(1); // IDLE: sin efecto
    h.service.move(1, IN_STAIRS); // → SAFE_STOP (1 fila)
    const afterStop = h.rows(1).length;

    h.service.move(1, FREE); // SAFE_STOP_ACTIVE
    h.robots.saveQuality(1, 'UNRELIABLE');
    h.service.recover(1); // rechazado: datos no confiables
    expect(h.rows(1)).toHaveLength(afterStop);

    h.robots.saveState(2, 'MOVING', { x: 488, y: 290 });
    h.service.move(2, FREE); // BUSY
    expect(h.rows(2)).toEqual([BASELINE]);
  });

  it('los robots son independientes: mover V2 no toca a A1', () => {
    h.service.move(2, FREE);

    expect(h.rows(1)).toEqual([BASELINE]);
    expect(h.robots.getStatus(1)?.position).toEqual({ x: 120, y: 90 });
    expect(h.rows(2)).toEqual([
      BASELINE,
      ['IDLE', 'MOVING', 'AUTHORIZED'],
      ['MOVING', 'IDLE', 'MOVE_COMPLETED'],
    ]);
    expect(h.robots.getStatus(2)?.position).toEqual(FREE);
  });

  it('un robot inexistente lanza 404 ROBOT_NOT_FOUND', () => {
    expect(() => h.service.move(99, FREE)).toThrow(/not found/i);
    expect(() => h.service.recover(99)).toThrow(/not found/i);
  });

  it('un fallo al registrar la transición revierte el estado (transacción única)', () => {
    h.db.exec('DROP TRIGGER state_transition_log_no_delete');
    h.db.exec('DROP TABLE state_transition_log');
    expect(() => h.service.move(1, FREE)).toThrow();
    expect(h.robots.getStatus(1)).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
  });
});
