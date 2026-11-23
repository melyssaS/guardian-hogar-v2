import type { Point, Zone } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createTestDb, createTestGuardian, type TestGuardian } from '../helpers.js';

// Spec 002 — RC-15 (R12.2, R9.5, R5.10, Property 16): alta de robot en el vigilante.
//   checkStartPosition(position, identity) → ok | rejected 409 (auditado con robot/estado nulos)
//   initRobot(robotId, position)           → INSERT simple del estado + T9 (ROBOT_REGISTERED)

const HOME: Point = { x: 120, y: 90 };
const IN_STAIRS: Point = { x: 100, y: 300 };
const IDENTITY = { name: 'Robot Nuevo', type: 'GUARD' } as const;

function build(db: Db, opts: { getActiveZones?: () => Zone[]; pad?: number } = {}): TestGuardian {
  const zones = createZoneRepository(db);
  return createTestGuardian(db, {
    robots: createRobotRepository(db),
    incidents: createIncidentRepository(db),
    audit: createAuditLogRepository(db),
    transitions: createTransitionLogRepository(db),
    getActiveZones: opts.getActiveZones ?? (() => zones.findAll('active')),
    runInTransaction: (fn) => db.transaction(fn)(),
    ...(opts.pad === undefined ? {} : { pad: opts.pad }),
  });
}

const count = (db: Db, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function readAudit(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare('SELECT robot_id, event_code, state, x, y, detail FROM audit_log ORDER BY id')
    .all() as Array<Record<string, unknown>>;
}

describe('guardianService.checkStartPosition', () => {
  let db: Db;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    service = build(db, { pad: 0 });
  });

  it('fuera de toda zona activa: ok y sin auditoría', () => {
    expect(service.checkStartPosition(HOME, IDENTITY)).toEqual({ kind: 'ok', value: undefined });
    expect(readAudit(db)).toHaveLength(0);
  });

  it('dentro de una zona activa: rejected 409 ROBOT_START_IN_RESTRICTED_ZONE', () => {
    const out = service.checkStartPosition(IN_STAIRS, IDENTITY);
    expect(out).toMatchObject({
      kind: 'rejected',
      code: 'ROBOT_START_IN_RESTRICTED_ZONE',
      status: 409,
    });
    expect(out).not.toHaveProperty('cause');
  });

  it('audita con robot_id y state nulos, x/y = posición y detail { name, type } (Property 16)', () => {
    const robotsBefore = count(db, 'robots');
    const stateBefore = count(db, 'robot_state');

    service.checkStartPosition(IN_STAIRS, IDENTITY);

    // Se lee tras la llamada: la fila quedó confirmada aunque el alta se rechace.
    const audit = readAudit(db);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      robot_id: null,
      event_code: 'ROBOT_START_IN_RESTRICTED_ZONE',
      state: null,
      x: IN_STAIRS.x,
      y: IN_STAIRS.y,
    });
    expect(JSON.parse(audit[0]?.detail as string)).toEqual({ name: 'Robot Nuevo', type: 'GUARD' });
    expect(count(db, 'robots')).toBe(robotsBefore);
    expect(count(db, 'robot_state')).toBe(stateBefore);
  });

  it('aplica el pad r + m: un punto a 10 de la zona se rechaza con pad 15 y se acepta con pad 0', () => {
    const padded = build(db, { pad: 15 });
    // Escaleras empieza en y = 226: (100, 216) está a 10, dentro de la expansión de 15.
    expect(padded.checkStartPosition({ x: 100, y: 216 }, IDENTITY)).toMatchObject({
      kind: 'rejected',
      code: 'ROBOT_START_IN_RESTRICTED_ZONE',
    });
    expect(service.checkStartPosition({ x: 100, y: 216 }, IDENTITY).kind).toBe('ok');
  });

  it('las zonas inactivas no cuentan', () => {
    db.prepare("UPDATE zones SET active = 0 WHERE name = 'Escaleras'").run();
    expect(service.checkStartPosition(IN_STAIRS, IDENTITY).kind).toBe('ok');
  });

  it('zonas no legibles: rejected 409 ROBOT_START_NOT_VERIFIABLE con cause ZONE_DATA_UNAVAILABLE', () => {
    const failing = build(db, {
      getActiveZones: () => {
        throw new Error('zones down');
      },
    });
    const out = failing.checkStartPosition(HOME, IDENTITY);
    expect(out).toMatchObject({
      kind: 'rejected',
      code: 'ROBOT_START_NOT_VERIFIABLE',
      status: 409,
      cause: 'ZONE_DATA_UNAVAILABLE',
    });
    const audit = readAudit(db);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      robot_id: null,
      event_code: 'ROBOT_START_NOT_VERIFIABLE',
      state: null,
      x: HOME.x,
      y: HOME.y,
    });
    expect(JSON.parse(audit[0]?.detail as string)).toEqual({
      name: 'Robot Nuevo',
      type: 'GUARD',
      cause: 'ZONE_DATA_UNAVAILABLE',
    });
    // Sin filas en robots ni robot_state y con la auditoría confirmada.
    expect(count(db, 'robots')).toBe(2);
    expect(count(db, 'robot_state')).toBe(2);
  });
});

describe('guardianService.initRobot', () => {
  let db: Db;
  let service: TestGuardian;
  let robots: ReturnType<typeof createRobotRepository>;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    service = build(db, { pad: 0 });
    robots = createRobotRepository(db);
  });

  /** El catálogo (spec 003) inserta en `robots` antes de llamar a `initRobot`. */
  const registerCatalogRow = (name = 'Robot Nuevo') =>
    createRobotCatalogRepository(db).create({ name, type: 'GUARD' }).id;

  it('crea el estado inicial IDLE / RELIABLE en la posición dada y registra T9', () => {
    const id = registerCatalogRow();
    expect(service.initRobot(id, HOME)).toBeUndefined();

    expect(robots.getStatus(id)).toEqual({
      robotId: id,
      state: 'IDLE',
      position: HOME,
      positionQuality: 'RELIABLE',
    });
    expect(createTransitionLogRepository(db).findByRobot(id)).toEqual([
      expect.objectContaining({ fromState: null, toState: 'IDLE', cause: 'ROBOT_REGISTERED' }),
    ]);
  });

  it('el robot recién registrado ya se puede mover', () => {
    const id = registerCatalogRow();
    service.initRobot(id, HOME);
    expect(service.move(id, { x: 450, y: 120 })).toMatchObject({ decision: 'AUTHORIZED' });
  });

  it('con la fila de estado ya existente lanza y no deja transición nueva', () => {
    const transitionsBefore = count(db, 'state_transition_log');
    expect(() => service.initRobot(1, HOME)).toThrow();
    expect(count(db, 'state_transition_log')).toBe(transitionsBefore);
    // Nunca reinicia un robot existente: A1 sigue donde estaba.
    expect(robots.getStatus(1)).toMatchObject({ state: 'IDLE', position: HOME });
  });

  it('con una posición insegura lanza (defensa en profundidad) y revierte todo', () => {
    const id = registerCatalogRow();
    const transitionsBefore = count(db, 'state_transition_log');
    expect(() => service.initRobot(id, IN_STAIRS)).toThrow(/restricted zone/i);
    expect(robots.getStatus(id)).toBeNull();
    expect(count(db, 'state_transition_log')).toBe(transitionsBefore);
  });

  it('si las zonas no se pueden leer, lanza y no crea nada (no hay alta sin verificar)', () => {
    const failing = build(db, {
      getActiveZones: () => {
        throw new Error('down');
      },
    });
    const id = registerCatalogRow();
    expect(() => failing.initRobot(id, HOME)).toThrow();
    expect(robots.getStatus(id)).toBeNull();
  });

  it('dentro de la transacción del catálogo: si initRobot lanza se revierte también la fila de robots', () => {
    const catalog = createRobotCatalogRepository(db);
    expect(() =>
      db.transaction(() => {
        const created = catalog.create({ name: 'Efímero', type: 'VACUUM' });
        service.initRobot(created.id, IN_STAIRS);
      })(),
    ).toThrow();
    expect(catalog.list().map((r) => r.name)).toEqual(['Aspiradora A1', 'Vigilante V2']);
  });
});
