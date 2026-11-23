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

// Spec 002 — RC-12 (R4.4, R4.5, R4.6, Property 16): contrato de `recover` con ServiceResult.

const IN_STAIRS: Point = { x: 100, y: 300 }; // dentro de Escaleras (activa)
const HOME: Point = { x: 120, y: 90 };

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

function readAudit(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare('SELECT robot_id, event_code, state, x, y, detail FROM audit_log ORDER BY id')
    .all() as Array<Record<string, unknown>>;
}

function transitionCount(db: Db, robotId: number): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM state_transition_log WHERE robot_id = ?')
      .get(robotId) as { n: number }
  ).n;
}

describe('guardianService.recover — contrato RC-01', () => {
  let db: Db;
  let robots: ReturnType<typeof createRobotRepository>;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    robots = createRobotRepository(db);
    service = build(db);
  });

  it('R4.5 éxito desde SAFE_STOP: ok con transitioned:true, robotId y positionQuality', () => {
    service.move(1, IN_STAIRS); // → SAFE_STOP, posición (120, 90) segura
    expect(service.recover(1)).toEqual({
      kind: 'ok',
      value: {
        robotId: 1,
        state: 'IDLE',
        position: HOME,
        positionQuality: 'RELIABLE',
        transitioned: true,
      },
    });
    expect(robots.getStatus(1)?.state).toBe('IDLE');
  });

  it('R4.5 en IDLE: ok con transitioned:false, sin transición y auditado como RECOVER_NOOP', () => {
    const before = transitionCount(db, 1);
    expect(service.recover(1)).toEqual({
      kind: 'ok',
      value: {
        robotId: 1,
        state: 'IDLE',
        position: HOME,
        positionQuality: 'RELIABLE',
        transitioned: false,
      },
    });
    expect(transitionCount(db, 1)).toBe(before);
    expect(readAudit(db)).toEqual([
      { robot_id: 1, event_code: 'RECOVER_NOOP', state: 'IDLE', x: null, y: null, detail: null },
    ]);
  });

  it('R4.4 UNSAFE_POSITION: rejected 409 con cause, estado sin cambios y auditoría confirmada', () => {
    robots.saveState(1, 'SAFE_STOP', IN_STAIRS);
    const before = transitionCount(db, 1);

    const result = service.recover(1);

    expect(result).toMatchObject({
      kind: 'rejected',
      code: 'RECOVERY_NOT_ALLOWED',
      status: 409,
      cause: 'UNSAFE_POSITION',
    });
    expect(robots.getStatus(1)).toMatchObject({ state: 'SAFE_STOP', position: IN_STAIRS });
    expect(transitionCount(db, 1)).toBe(before);
    const audit = readAudit(db);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      robot_id: 1,
      event_code: 'RECOVERY_NOT_ALLOWED',
      state: 'SAFE_STOP',
      x: IN_STAIRS.x,
      y: IN_STAIRS.y,
    });
    expect(JSON.parse(audit[0]?.detail as string)).toMatchObject({ cause: 'UNSAFE_POSITION' });
  });

  it.each([
    ['UNRELIABLE', 'UNRELIABLE_DATA'],
    ['MISSING', 'UNRELIABLE_DATA'],
  ] as const)('R4.4 calidad %s → cause %s (prioridad sobre la posición)', (quality, cause) => {
    robots.saveState(1, 'DEGRADED', IN_STAIRS); // también insegura: la calidad se evalúa primero
    robots.saveQuality(1, quality);
    expect(service.recover(1)).toMatchObject({ kind: 'rejected', cause });
    expect(robots.getStatus(1)).toMatchObject({ state: 'DEGRADED', positionQuality: quality });
    expect(readAudit(db)[0]).toMatchObject({
      event_code: 'RECOVERY_NOT_ALLOWED',
      state: 'DEGRADED',
    });
  });

  it('R4.4 zonas no legibles → cause ZONE_DATA_UNAVAILABLE (no verifiable)', () => {
    const failing = build(db, () => {
      throw new Error('db down');
    });
    robots.saveState(1, 'SAFE_STOP', HOME);
    expect(failing.recover(1)).toMatchObject({
      kind: 'rejected',
      code: 'RECOVERY_NOT_ALLOWED',
      cause: 'ZONE_DATA_UNAVAILABLE',
    });
    expect(robots.getStatus(1)?.state).toBe('SAFE_STOP');
    expect(readAudit(db)).toHaveLength(1);
  });

  it('R4.4 una zona desactivada ya no impide recuperar (solo cuentan las activas)', () => {
    robots.saveState(1, 'SAFE_STOP', IN_STAIRS);
    expect(service.recover(1)).toMatchObject({ kind: 'rejected', cause: 'UNSAFE_POSITION' });
    db.prepare("UPDATE zones SET active = 0 WHERE name = 'Escaleras'").run();
    expect(service.recover(1)).toMatchObject({ kind: 'ok', value: { transitioned: true } });
  });

  it('R4.6 éxito: T6 y T7 en la misma transacción, T7 con el snapshot de zonas', () => {
    service.move(1, IN_STAIRS);
    service.recover(1);
    const rows = db
      .prepare(
        'SELECT from_state, to_state, cause, detail FROM state_transition_log WHERE robot_id = 1 ORDER BY id DESC LIMIT 2',
      )
      .all() as Array<{
      from_state: string;
      to_state: string;
      cause: string;
      detail: string | null;
    }>;
    expect(rows.map((r) => [r.from_state, r.to_state, r.cause])).toEqual([
      ['RECOVERING', 'IDLE', 'RECOVER_COMPLETED'],
      ['SAFE_STOP', 'RECOVERING', 'RECOVER_REQUESTED'],
    ]);
    expect(
      (JSON.parse(rows[0]?.detail as string) as { zonesSnapshot: unknown[] }).zonesSnapshot,
    ).toHaveLength(2);
  });

  it('Property 16: un recover rechazado no crea incidente y el audit_log lo conserva', () => {
    robots.saveState(1, 'SAFE_STOP', IN_STAIRS);
    service.recover(1);
    service.recover(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM incidents').get()).toEqual({ n: 0 });
    expect(readAudit(db).map((r) => r.event_code)).toEqual([
      'RECOVERY_NOT_ALLOWED',
      'RECOVERY_NOT_ALLOWED',
    ]);
  });

  it('Property 15: recuperar V2 (robot 2) audita robot_id = 2 y no toca a A1', () => {
    robots.saveState(2, 'SAFE_STOP', { x: 488, y: 290 });
    expect(service.recover(2)).toMatchObject({ kind: 'ok', value: { robotId: 2 } });
    expect(robots.getStatus(1)?.state).toBe('IDLE');
    service.recover(2); // ahora en IDLE → NOOP
    expect(readAudit(db)).toEqual([
      expect.objectContaining({ robot_id: 2, event_code: 'RECOVER_NOOP' }),
    ]);
  });

  it('robot inexistente: 404 ROBOT_NOT_FOUND', () => {
    expect(() => service.recover(99)).toThrowError(
      expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }),
    );
  });
});
