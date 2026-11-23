import type { Zone } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import {
  createRobotCatalogService,
  type RobotCatalogService,
} from '../../src/services/robotCatalogService.js';
import { createGuardianService } from '../../src/services/guardianService.js';
import { createTestDb, createTestSessions } from '../helpers.js';

// Spec 003 — RC-9 (RF-07.1, RF-07.3, RF-07.4, RF-07.9, RF-07.10, Property 8, 11; CA-03.9,
// CA-03.22, CA-03.35, CA-03.36, DD-118, DD-129): `robotCatalogService.register` registra el robot
// y su estado inicial en UNA transacción: checkStartPosition → INSERT robots → initRobot.

const START = { x: 120, y: 90 };

interface Harness {
  db: Db;
  catalog: RobotCatalogService;
  initCalls: number[];
}

function build(db: Db, opts: { getActiveZones?: () => Zone[]; failInit?: boolean } = {}): Harness {
  const zones = createZoneRepository(db);
  const sessions = createTestSessions(db);
  const guardian = createGuardianService({
    robots: createRobotRepository(db),
    incidents: createIncidentRepository(db),
    audit: createAuditLogRepository(db),
    transitions: createTransitionLogRepository(db),
    sessions,
    getActiveZones: opts.getActiveZones ?? (() => zones.findAll('active')),
    runInTransaction: (fn) => db.transaction(fn)(),
    pad: 0,
  });
  const initCalls: number[] = [];
  const catalog = createRobotCatalogService({
    catalog: createRobotCatalogRepository(db),
    robots: createRobotRepository(db),
    sessions,
    guardian: {
      checkStartPosition: (position, robot) => guardian.checkStartPosition(position, robot),
      initRobot: (robotId, position) => {
        initCalls.push(robotId);
        if (opts.failInit) throw new Error('initRobot failed');
        guardian.initRobot(robotId, position);
      },
    },
    runInTransaction: (fn) => db.transaction(fn).immediate(),
  });
  return { db, catalog, initCalls };
}

const count = (db: Db, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const audit = (db: Db) =>
  db
    .prepare('SELECT robot_id, event_code, state, x, y, detail FROM audit_log ORDER BY id')
    .all() as Array<Record<string, unknown>>;

describe('robotCatalogService.register', () => {
  let db: Db;
  let h: Harness;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db); // "Sala" (29, 30, 250 x 178) existe pero está inactiva
    h = build(db);
  });

  it('crea el robot con el estado inicial que le da el vigilante: IDLE, RELIABLE, (120, 90)', () => {
    const result = h.catalog.register({ name: 'Robot Nuevo', type: 'GUARD' });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('se esperaba ok');
    expect(result.value).toEqual({
      id: 3,
      name: 'Robot Nuevo',
      type: 'GUARD',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      state: 'IDLE',
      position: START,
      positionQuality: 'RELIABLE',
      lastRequest: null,
    });
    // El estado lo creó guardianService.initRobot (no el catálogo) y registró T9.
    expect(h.initCalls).toEqual([3]);
    expect(createTransitionLogRepository(db).findByRobot(3)).toEqual([
      expect.objectContaining({ fromState: null, toState: 'IDLE', cause: 'ROBOT_REGISTERED' }),
    ]);
    // Persistencia: el robot sigue disponible en la lista.
    expect(h.catalog.list().map((r) => r.name)).toEqual([
      'Aspiradora A1',
      'Vigilante V2',
      'Robot Nuevo',
    ]);
  });

  it('con la zona "Sala" activa: rejected 409 ROBOT_START_IN_RESTRICTED_ZONE, auditado y sin crear nada', () => {
    db.prepare("UPDATE zones SET active = 1 WHERE name = 'Sala'").run();
    const robotsBefore = count(db, 'robots');
    const statesBefore = count(db, 'robot_state');

    const result = h.catalog.register({ name: 'Robot Nuevo', type: 'GUARD' });

    expect(result).toMatchObject({
      kind: 'rejected',
      code: 'ROBOT_START_IN_RESTRICTED_ZONE',
      status: 409,
    });
    // La fila se lee DESPUÉS de confirmar (Property 11): robot y estado nulos, (120, 90) y detail.
    const rows = audit(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      robot_id: null,
      event_code: 'ROBOT_START_IN_RESTRICTED_ZONE',
      state: null,
      x: START.x,
      y: START.y,
    });
    expect(JSON.parse(rows[0]?.detail as string)).toEqual({ name: 'Robot Nuevo', type: 'GUARD' });
    expect(count(db, 'robots')).toBe(robotsBefore);
    expect(count(db, 'robot_state')).toBe(statesBefore);
    expect(h.initCalls).toEqual([]);
  });

  it('las zonas no legibles: rejected 409 ROBOT_START_NOT_VERIFIABLE con cause y sin filas nuevas (CA-03.35)', () => {
    const failing = build(db, {
      getActiveZones: () => {
        throw new Error('zones down');
      },
    });
    const result = failing.catalog.register({ name: 'Robot Nuevo', type: 'GUARD' });

    expect(result).toMatchObject({
      kind: 'rejected',
      code: 'ROBOT_START_NOT_VERIFIABLE',
      status: 409,
      cause: 'ZONE_DATA_UNAVAILABLE',
    });
    const rows = audit(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ robot_id: null, event_code: 'ROBOT_START_NOT_VERIFIABLE' });
    expect(JSON.parse(rows[0]?.detail as string)).toMatchObject({ cause: 'ZONE_DATA_UNAVAILABLE' });
    expect(count(db, 'robots')).toBe(2);
    expect(count(db, 'robot_state')).toBe(2);
  });

  it('nombre repetido: 409 ROBOT_NAME_DUPLICATE (lanza) sin auditar aunque "Sala" esté activa (CA-03.36)', () => {
    db.prepare("UPDATE zones SET active = 1 WHERE name = 'Sala'").run();
    expect(() => h.catalog.register({ name: 'Aspiradora A1', type: 'VACUUM' })).toThrowError(
      expect.objectContaining({ status: 409, code: 'ROBOT_NAME_DUPLICATE' }),
    );
    // Orden de validación: el nombre se comprueba antes que la posición, así que no hay auditoría.
    expect(audit(db)).toHaveLength(0);
    expect(count(db, 'robots')).toBe(2);
  });

  it('si initRobot falla, no queda fila en robots (transacción única, Property 8)', () => {
    const failing = build(db, { failInit: true });
    expect(() => failing.catalog.register({ name: 'Robot Nuevo', type: 'GUARD' })).toThrow(
      /initRobot failed/,
    );
    expect(count(db, 'robots')).toBe(2);
    expect(count(db, 'robot_state')).toBe(2);
    expect(
      createRobotCatalogRepository(db)
        .list()
        .map((r) => r.name),
    ).not.toContain('Robot Nuevo');
  });

  it('el catálogo no escribe robot_state ni state_transition_log por su cuenta (Property 12)', () => {
    h.catalog.register({ name: 'Otro', type: 'VACUUM' });
    // Una sola fila de transición para el robot nuevo, escrita por initRobot (T9).
    expect(count(db, 'state_transition_log')).toBe(3); // 2 filas base + T9
  });
});

describe('robotCatalogService.list / get', () => {
  it('list devuelve A1 y V2 con su estado, calidad y lastRequest', () => {
    const db = createTestDb();
    const { catalog } = build(db);
    expect(catalog.list()).toEqual([
      expect.objectContaining({
        id: 1,
        name: 'Aspiradora A1',
        type: 'VACUUM',
        state: 'IDLE',
        position: START,
        positionQuality: 'RELIABLE',
        lastRequest: null,
      }),
      expect.objectContaining({
        id: 2,
        name: 'Vigilante V2',
        type: 'GUARD',
        position: { x: 488, y: 290 },
        lastRequest: null,
      }),
    ]);
  });

  it('get incluye lastRequest tras una solicitud aceptada y lanza 404 si no existe', () => {
    const db = createTestDb();
    const sessions = createTestSessions(db);
    const { catalog } = build(db);
    const { sessionId } = sessions.startSession(2);
    sessions.acceptRequest(2, { destination: { x: 10, y: 20 }, sessionId, sequence: 1 }, 'IDLE');
    expect(catalog.get(2).lastRequest).toMatchObject({ sessionId, sequence: 1 });
    expect(() => catalog.get(99)).toThrowError(
      expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }),
    );
  });
});
