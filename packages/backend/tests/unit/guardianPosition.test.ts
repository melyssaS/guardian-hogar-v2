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

// Spec 002 — RC-13 (R3.6, R5.11, R8.5-R8.7, Property 13, Property 16): lecturas de posición.

const HOME: Point = { x: 120, y: 90 };
const FREE: Point = { x: 450, y: 120 };
const IN_STAIRS: Point = { x: 100, y: 300 };

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

function transitions(db: Db, robotId: number): Array<Record<string, unknown>> {
  return db
    .prepare(
      'SELECT from_state, to_state, cause, detail FROM state_transition_log WHERE robot_id = ? ORDER BY id',
    )
    .all(robotId) as Array<Record<string, unknown>>;
}

function incidentRows(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT robot_id, rule, zone_name, decision_code, state_after, origin_x, origin_y, dest_x, dest_y, collision_type, zones_snapshot
       FROM incidents ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;
}

describe('guardianService.setPosition — lecturas de posición', () => {
  let db: Db;
  let robots: ReturnType<typeof createRobotRepository>;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    robots = createRobotRepository(db);
    service = build(db);
  });

  describe('RELIABLE (R8.5)', () => {
    it('coincide con la posición actual: ok, fija solo la calidad y audita POSITION_READING', () => {
      robots.saveQuality(1, 'MISSING');
      const out = service.setPosition(1, { position: HOME, quality: 'RELIABLE' });

      expect(out).toEqual({
        kind: 'ok',
        value: { state: 'IDLE', position: HOME, positionQuality: 'RELIABLE' },
      });
      expect(robots.getStatus(1)).toMatchObject({ position: HOME, positionQuality: 'RELIABLE' });
      const audit = readAudit(db);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        robot_id: 1,
        event_code: 'POSITION_READING',
        state: 'IDLE',
        x: HOME.x,
        y: HOME.y,
      });
      expect(JSON.parse(audit[0]?.detail as string)).toMatchObject({ quality: 'RELIABLE' });
      // R9.6: sin cambio de estado no hay transición ni incidente.
      expect(transitions(db, 1)).toHaveLength(1); // solo la fila base
      expect(incidentRows(db)).toHaveLength(0);
    });

    it('no coincide: rejected 409 POSITION_CONFLICT, nada cambia y se audita (Property 16)', () => {
      robots.saveQuality(1, 'MISSING');
      const before = robots.getStatus(1);

      const out = service.setPosition(1, { position: FREE, quality: 'RELIABLE' });

      expect(out).toMatchObject({ kind: 'rejected', code: 'POSITION_CONFLICT', status: 409 });
      expect(robots.getStatus(1)).toEqual(before); // posición Y calidad sin cambios
      const audit = readAudit(db);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        robot_id: 1,
        event_code: 'POSITION_CONFLICT',
        state: 'IDLE',
        x: FREE.x,
        y: FREE.y,
      });
      // R8.5: audita la posición y calidad previas y las recibidas.
      expect(JSON.parse(audit[0]?.detail as string)).toEqual({
        previous: { position: HOME, quality: 'MISSING' },
        received: { position: FREE, quality: 'RELIABLE' },
      });
    });

    it('fuera del plano: 422 POSITION_OUT_OF_BOUNDS sin cambios', () => {
      const before = robots.getStatus(1);
      expect(() =>
        service.setPosition(1, { position: { x: 9999, y: 10 }, quality: 'RELIABLE' }),
      ).toThrowError(expect.objectContaining({ status: 422, code: 'POSITION_OUT_OF_BOUNDS' }));
      expect(robots.getStatus(1)).toEqual(before);
    });

    it('no teletransporta: un robot en SAFE_STOP dentro de una zona no se libera con una lectura', () => {
      robots.saveState(1, 'SAFE_STOP', IN_STAIRS);
      const out = service.setPosition(1, { position: HOME, quality: 'RELIABLE' });
      expect(out).toMatchObject({ kind: 'rejected', code: 'POSITION_CONFLICT' });
      expect(robots.getStatus(1)).toMatchObject({ position: IN_STAIRS });
      expect(service.recover(1)).toMatchObject({ kind: 'rejected', cause: 'UNSAFE_POSITION' });
    });

    it('en parada acepta una lectura coincidente: solo calidad, sin cambiar el estado', () => {
      robots.saveState(1, 'DEGRADED', HOME);
      robots.saveQuality(1, 'MISSING');
      const out = service.setPosition(1, { position: HOME, quality: 'RELIABLE' });
      expect(out).toMatchObject({ kind: 'ok', value: { state: 'DEGRADED' } });
      expect(robots.getStatus(1)).toMatchObject({ state: 'DEGRADED', positionQuality: 'RELIABLE' });
    });
  });

  describe('Property 13: una lectura nunca relocaliza', () => {
    it.each([
      FREE,
      IN_STAIRS,
      { x: 0, y: 0 },
      { x: 120.0001, y: 90 },
      { x: 120, y: 90.5 },
      { x: -5, y: 90 },
    ] as Point[])(
      'RELIABLE en %j distinta de la actual: la posición persistida no cambia',
      (position) => {
        const before = robots.getStatus(1);
        try {
          service.setPosition(1, { position, quality: 'RELIABLE' });
        } catch {
          // 422 fuera del plano: tampoco cambia nada.
        }
        expect(robots.getStatus(1)).toEqual(before);
      },
    );

    it.each(['UNRELIABLE', 'MISSING'] as const)(
      '%s con otra posición tampoco relocaliza (la posición recibida se ignora)',
      (quality) => {
        service.setPosition(1, { position: FREE, quality });
        expect(robots.getStatus(1)?.position).toEqual(HOME);
      },
    );
  });

  describe('pérdida de señal UNRELIABLE / MISSING (R8.6, R3.6, R5.11)', () => {
    it.each(['MISSING', 'UNRELIABLE'] as const)(
      '%s en IDLE: T5 IDLE → DEGRADED y un incidente R-SIGNAL-01 POSITION_QUALITY_LOST',
      (quality) => {
        const out = service.setPosition(1, { position: HOME, quality });

        expect(out).toEqual({
          kind: 'ok',
          value: { state: 'DEGRADED', position: HOME, positionQuality: quality },
        });
        expect(robots.getStatus(1)).toMatchObject({ state: 'DEGRADED', positionQuality: quality });

        const incidents = incidentRows(db);
        expect(incidents).toEqual([
          {
            robot_id: 1,
            rule: 'R-SIGNAL-01',
            zone_name: null,
            decision_code: 'POSITION_QUALITY_LOST',
            state_after: 'DEGRADED',
            origin_x: HOME.x,
            origin_y: HOME.y,
            dest_x: HOME.x,
            dest_y: HOME.y,
            collision_type: null,
            zones_snapshot: '[]',
          },
        ]);
        const rows = transitions(db, 1);
        expect(rows).toHaveLength(2);
        expect(rows[1]).toMatchObject({
          from_state: 'IDLE',
          to_state: 'DEGRADED',
          cause: 'POSITION_QUALITY_LOST',
        });
        expect(JSON.parse(rows[1]?.detail as string)).toEqual({ incidentId: 1 });
      },
    );

    it('acepta la pérdida aunque la posición recibida esté fuera del plano (se ignora)', () => {
      const out = service.setPosition(1, { position: { x: 99999, y: -5 }, quality: 'MISSING' });
      expect(out).toMatchObject({
        kind: 'ok',
        value: { state: 'DEGRADED', position: HOME, positionQuality: 'MISSING' },
      });
      expect(readAudit(db)[0]).toMatchObject({
        robot_id: 1,
        event_code: 'POSITION_READING',
        state: 'IDLE', // el estado en el momento de la lectura
      });
    });

    it('la incidencia usa la posición ACTUAL del robot como origen y destino, no la recibida', () => {
      robots.saveState(1, 'IDLE', FREE);
      service.setPosition(1, { position: HOME, quality: 'MISSING' });
      expect(incidentRows(db)[0]).toMatchObject({
        origin_x: FREE.x,
        origin_y: FREE.y,
        dest_x: FREE.x,
        dest_y: FREE.y,
      });
    });

    it('en parada (SAFE_STOP) solo cambia la calidad: sin transición ni incidente nuevo', () => {
      service.move(1, IN_STAIRS); // → SAFE_STOP, 1 incidente
      const incidentsBefore = incidentRows(db).length;
      const transitionsBefore = transitions(db, 1).length;

      const out = service.setPosition(1, { position: HOME, quality: 'UNRELIABLE' });

      expect(out).toMatchObject({
        kind: 'ok',
        value: { state: 'SAFE_STOP', positionQuality: 'UNRELIABLE' },
      });
      expect(incidentRows(db)).toHaveLength(incidentsBefore);
      expect(transitions(db, 1)).toHaveLength(transitionsBefore);
    });

    it('si ya está en DEGRADED no crea otro incidente al repetir la pérdida', () => {
      service.setPosition(1, { position: HOME, quality: 'MISSING' });
      service.setPosition(1, { position: HOME, quality: 'UNRELIABLE' });
      expect(incidentRows(db)).toHaveLength(1);
      expect(transitions(db, 1)).toHaveLength(2);
      expect(robots.getStatus(1)?.positionQuality).toBe('UNRELIABLE');
    });

    it('todas las lecturas quedan en audit_log con la calidad recibida (R8.7)', () => {
      service.setPosition(1, { position: HOME, quality: 'MISSING' });
      service.setPosition(1, { position: HOME, quality: 'RELIABLE' });
      service.setPosition(1, { position: FREE, quality: 'RELIABLE' });
      expect(readAudit(db).map((r) => r.event_code)).toEqual([
        'POSITION_READING',
        'POSITION_READING',
        'POSITION_CONFLICT',
      ]);
      expect(
        readAudit(db).map(
          (r) => (JSON.parse(r.detail as string) as { quality?: string }).quality ?? null,
        ),
      ).toEqual(['MISSING', 'RELIABLE', null]);
    });

    it('Property 15: la pérdida de V2 no cambia a A1', () => {
      service.setPosition(2, { position: { x: 488, y: 290 }, quality: 'MISSING' });
      expect(robots.getStatus(2)).toMatchObject({ state: 'DEGRADED', positionQuality: 'MISSING' });
      expect(robots.getStatus(1)).toMatchObject({ state: 'IDLE', positionQuality: 'RELIABLE' });
      expect(incidentRows(db)).toMatchObject([{ robot_id: 2 }]);
    });
  });

  it('cadena completa: pérdida → lectura RELIABLE coincidente → recover → move AUTHORIZED', () => {
    service.setPosition(1, { position: HOME, quality: 'MISSING' });
    expect(service.move(1, FREE)).toMatchObject({ decision: 'REJECTED', code: 'SAFE_STOP_ACTIVE' });
    service.setPosition(1, { position: HOME, quality: 'RELIABLE' });
    expect(service.recover(1)).toMatchObject({ kind: 'ok', value: { transitioned: true } });
    expect(service.move(1, FREE)).toMatchObject({ decision: 'AUTHORIZED', position: FREE });
  });

  it('robot inexistente: 404 ROBOT_NOT_FOUND', () => {
    expect(() => service.setPosition(99, { position: HOME, quality: 'MISSING' })).toThrowError(
      expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }),
    );
  });
});
