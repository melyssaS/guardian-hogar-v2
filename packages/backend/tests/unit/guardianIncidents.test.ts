import type { Point, Zone } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createTestDb, createTestGuardian, type TestGuardian } from '../helpers.js';

// Spec 002 — RC-14 (R5.5): los incidentes nuevos llevan robot_id, rule (de ruleForDecision) y
// zone_name (solo en denegaciones geométricas).

const IN_STAIRS: Point = { x: 100, y: 300 };
const FREE: Point = { x: 450, y: 120 };

function build(db: Db, getActiveZones?: () => Zone[]): TestGuardian {
  const zones = createZoneRepository(db);
  return createTestGuardian(db, {
    robots: createRobotRepository(db),
    incidents: createIncidentRepository(db),
    audit: createAuditLogRepository(db),
    transitions: createTransitionLogRepository(db),
    getActiveZones: getActiveZones ?? (() => zones.findAll('active')),
    runInTransaction: (fn) => db.transaction(fn)(),
    pad: 0,
  });
}

function incidentRows(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare(
      'SELECT robot_id, rule, zone_name, decision_code, state_after FROM incidents ORDER BY id',
    )
    .all() as Array<Record<string, unknown>>;
}

describe('incidentes del vigilante con robot, regla y zona', () => {
  let db: Db;
  let robots: ReturnType<typeof createRobotRepository>;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    robots = createRobotRepository(db);
    service = build(db);
  });

  it('denegación geométrica de A1: robot_id 1, R-ZONA-01 y zone_name "Escaleras"', () => {
    service.move(1, IN_STAIRS);
    expect(incidentRows(db)).toEqual([
      {
        robot_id: 1,
        rule: 'R-ZONA-01',
        zone_name: 'Escaleras',
        decision_code: 'RESTRICTED_ZONE_VIOLATION',
        state_after: 'SAFE_STOP',
      },
    ]);
  });

  it('denegación geométrica de V2: robot_id 2 (el incidente es del robot implicado)', () => {
    service.move(2, IN_STAIRS);
    expect(incidentRows(db)).toMatchObject([{ robot_id: 2, rule: 'R-ZONA-01' }]);
  });

  it('INSUFFICIENT_DATA y MISSING_POSITION: R-SIGNAL-01 y zone_name NULL', () => {
    robots.saveQuality(1, 'UNRELIABLE');
    service.move(1, FREE);
    robots.saveQuality(2, 'MISSING');
    service.move(2, FREE);
    expect(incidentRows(db)).toEqual([
      expect.objectContaining({
        robot_id: 1,
        rule: 'R-SIGNAL-01',
        zone_name: null,
        decision_code: 'INSUFFICIENT_DATA',
      }),
      expect.objectContaining({
        robot_id: 2,
        rule: 'R-SIGNAL-01',
        zone_name: null,
        decision_code: 'MISSING_POSITION',
      }),
    ]);
  });

  it('ZONE_DATA_UNAVAILABLE: R-DATA-01 y zone_name NULL', () => {
    const failing = build(db, () => {
      throw new Error('down');
    });
    failing.move(1, FREE);
    expect(incidentRows(db)).toEqual([
      expect.objectContaining({
        rule: 'R-DATA-01',
        zone_name: null,
        decision_code: 'ZONE_DATA_UNAVAILABLE',
      }),
    ]);
  });

  it('un rechazo por estado no crea incidente (R5.3)', () => {
    service.move(1, IN_STAIRS);
    service.move(1, FREE);
    expect(incidentRows(db)).toHaveLength(1);
  });
});
