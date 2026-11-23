import type { Point } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createSessionRepository } from '../../src/repositories/sessionRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createGuardianService, type GuardianService } from '../../src/services/guardianService.js';
import { createTestDb, createTestSessions } from '../helpers.js';

// Spec 002 — RC-16 (decisión 2, N4-4, N5-2; R10.7): `moveLegacy` es la vía temporal sin sesión del
// controller antiguo de /api/robot/move. Esta prueba dedicada y `robot.api.test.ts` /
// `robotController.test.ts` son las únicas que pueden referenciarla; RC-20 la retira.

const HOME: Point = { x: 120, y: 90 };
const FREE: Point = { x: 450, y: 120 };
const IN_STAIRS: Point = { x: 100, y: 300 };

describe('guardianService.moveLegacy (desvío temporal declarado de R11)', () => {
  let db: Db;
  let service: GuardianService;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    const zones = createZoneRepository(db);
    service = createGuardianService({
      robots: createRobotRepository(db),
      incidents: createIncidentRepository(db),
      audit: createAuditLogRepository(db),
      transitions: createTransitionLogRepository(db),
      sessions: createTestSessions(db),
      getActiveZones: () => zones.findAll('active'),
      runInTransaction: (fn) => db.transaction(fn)(),
      pad: 0,
    });
  });

  it('evalúa con el mismo vigilante sin exigir sesión ni secuencia: AUTHORIZED con la forma antigua', () => {
    expect(service.moveLegacy(1, FREE)).toEqual({
      decision: 'AUTHORIZED',
      state: 'IDLE',
      position: FREE,
    });
  });

  it('denegación geométrica: crea el incidente del robot con regla y zona (mismo vigilante)', () => {
    const out = service.moveLegacy(1, IN_STAIRS);
    expect(out).toMatchObject({
      decision: 'DENIED',
      code: 'RESTRICTED_ZONE_VIOLATION',
      state: 'SAFE_STOP',
      position: HOME,
      rule: 'R-ZONA-01',
      zoneName: 'Escaleras',
    });
    expect(db.prepare('SELECT robot_id, rule, zone_name FROM incidents').all()).toEqual([
      { robot_id: 1, rule: 'R-ZONA-01', zone_name: 'Escaleras' },
    ]);
  });

  it('rechazo por estado: REJECTED y fila de auditoría con el robot', () => {
    service.moveLegacy(1, IN_STAIRS);
    expect(service.moveLegacy(1, FREE)).toMatchObject({
      decision: 'REJECTED',
      code: 'SAFE_STOP_ACTIVE',
    });
    expect(db.prepare('SELECT robot_id, event_code FROM audit_log').all()).toEqual([
      { robot_id: 1, event_code: 'SAFE_STOP_ACTIVE' },
    ]);
  });

  it('valida los límites del plano y el robot (404) como el move por robot', () => {
    expect(() => service.moveLegacy(1, { x: 5000, y: 1 })).toThrowError(
      expect.objectContaining({ status: 422, code: 'DESTINATION_OUT_OF_BOUNDS' }),
    );
    expect(() => service.moveLegacy(99, FREE)).toThrowError(
      expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }),
    );
  });

  it('no toca robot_sessions: no crea sesión ni consume secuencia', () => {
    service.moveLegacy(1, FREE);
    expect(db.prepare('SELECT COUNT(*) AS n FROM robot_sessions').get()).toEqual({ n: 0 });
    const sessions = createSessionRepository(db);
    const { sessionId } = createTestSessions(db).startSession(1);
    service.moveLegacy(1, { x: 500, y: 150 });
    expect(sessions.findLastSequence(1)).toBe(0);
    expect(sessions.findSessionId(1)).toBe(sessionId);
  });

  it('el move por robot sin sesión sigue dando INVALID_SESSION (R11 vigente)', () => {
    expect(
      service.move(1, {
        destination: FREE,
        sessionId: '55555555-5555-4555-8555-555555555555',
        sequence: 1,
      }),
    ).toMatchObject({ kind: 'rejected', code: 'INVALID_SESSION', status: 409 });
    expect(createRobotRepository(db).getStatus(1)).toMatchObject({ state: 'IDLE', position: HOME });
  });

  it('R9: la transición T1 de moveLegacy registra solo el destino (sin sesión)', () => {
    service.moveLegacy(1, FREE);
    const rows = createTransitionLogRepository(db).findByRobot(1);
    expect(rows[1]).toMatchObject({ cause: 'AUTHORIZED' });
    expect(rows[1]?.detail).toEqual({ destination: FREE });
  });
});
