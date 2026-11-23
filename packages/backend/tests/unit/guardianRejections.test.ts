import type { Point } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createTestDb, createTestGuardian, type TestGuardian } from '../helpers.js';

// Spec 002 — RC-11 (R5.8, R5.10, Property 16): el rechazo por estado de CUALQUIER robot queda
// auditado con su robot_id, y el estado del robot no cambia.

const IN_STAIRS: Point = { x: 100, y: 300 };
const FREE: Point = { x: 450, y: 120 };

function build(db: Db): TestGuardian {
  const zones = createZoneRepository(db);
  return createTestGuardian(db, {
    robots: createRobotRepository(db),
    incidents: createIncidentRepository(db),
    audit: createAuditLogRepository(db),
    transitions: createTransitionLogRepository(db),
    getActiveZones: () => zones.findAll('active'),
    runInTransaction: (fn) => db.transaction(fn)(),
    pad: 0,
  });
}

function readAudit(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare('SELECT robot_id, event_code, state, x, y FROM audit_log ORDER BY id')
    .all() as Array<Record<string, unknown>>;
}

describe('rechazos por estado auditados por robot (Property 16)', () => {
  let db: Db;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    service = build(db);
  });

  it('SAFE_STOP_ACTIVE de V2 (robot 2): la fila lleva robot_id = 2 y V2 no cambia', () => {
    expect(service.move(2, IN_STAIRS).decision).toBe('DENIED');
    const stopped = service.getState(2);
    expect(stopped.state).toBe('SAFE_STOP');

    const out = service.move(2, FREE);

    expect(out).toMatchObject({ decision: 'REJECTED', code: 'SAFE_STOP_ACTIVE' });
    expect(readAudit(db)).toEqual([
      { robot_id: 2, event_code: 'SAFE_STOP_ACTIVE', state: 'SAFE_STOP', x: FREE.x, y: FREE.y },
    ]);
    expect(service.getState(2)).toEqual(stopped);
    // El robot A1 no se ve afectado (Property 15).
    expect(service.getState(1).state).toBe('IDLE');
  });

  it('BUSY de V2 (MOVING sembrado): fila con robot_id = 2, estado MOVING y sin cambios', () => {
    db.prepare("UPDATE robot_state SET state = 'MOVING' WHERE robot_id = 2").run();
    const before = service.getState(2);

    const out = service.move(2, FREE);

    expect(out).toMatchObject({ decision: 'REJECTED', code: 'BUSY', state: 'MOVING' });
    expect(readAudit(db)).toEqual([
      { robot_id: 2, event_code: 'BUSY', state: 'MOVING', x: FREE.x, y: FREE.y },
    ]);
    expect(service.getState(2)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM incidents').get()).toEqual({ n: 0 });
  });

  it('la fila de auditoría queda confirmada tras el rechazo (se lee fuera de la transacción)', () => {
    db.prepare("UPDATE robot_state SET state = 'SAFE_STOP' WHERE robot_id = 1").run();
    service.move(1, FREE);
    expect(readAudit(db)).toHaveLength(1);
    expect(readAudit(db)[0]).toMatchObject({ robot_id: 1, event_code: 'SAFE_STOP_ACTIVE' });
  });
});
