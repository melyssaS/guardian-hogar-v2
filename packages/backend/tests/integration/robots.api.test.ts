import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createSessionRepository } from '../../src/repositories/sessionRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createGuardianRoutes } from '../../src/routes/guardianRoutes.js';
import { createRobotsRoutes } from '../../src/routes/robotsRoutes.js';
import { createGuardianService } from '../../src/services/guardianService.js';
import { createRobotCatalogService } from '../../src/services/robotCatalogService.js';
import { createSessionService } from '../../src/services/sessionService.js';
import { createTestDb } from '../helpers.js';

// Spec 003 — RC-11 (RF-06.1, RF-07, RF-08.3, RF-08.4, RF-08.8, RF-08.9; CA-03.9..CA-03.12,
// CA-03.20, CA-03.22, CA-03.25, CA-03.35; Property 11): integración Supertest sobre una app de
// prueba con las rutas del catálogo (`robotsRoutes`) y las por robot de la 002 (`guardianRoutes`),
// sin pasar por `app.ts`. Tras CADA 409 se lee `audit_log` (la fila ya está confirmada).

const FREE = { x: 450, y: 120 };
const IN_STAIRS = { x: 100, y: 300 };
const START = { x: 120, y: 90 };

describe('API /api/robots (catálogo, sesiones y rutas por robot)', () => {
  let db: Db;
  let app: Express;
  let zonesDown = false;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    zonesDown = false;
    const zones = createZoneRepository(db);
    const robots = createRobotRepository(db);
    const audit = createAuditLogRepository(db);
    const run = <T>(fn: () => T): T => db.transaction(fn)();
    const sessions = createSessionService({
      sessions: createSessionRepository(db),
      audit,
      robots,
      runInTransaction: run,
    });
    const guardian = createGuardianService({
      robots,
      incidents: createIncidentRepository(db),
      audit,
      transitions: createTransitionLogRepository(db),
      sessions,
      getActiveZones: () => {
        if (zonesDown) throw new Error('zones down');
        return zones.findAll('active');
      },
      runInTransaction: run,
      pad: 0,
    });
    const catalog = createRobotCatalogService({
      catalog: createRobotCatalogRepository(db),
      robots,
      sessions,
      guardian,
      runInTransaction: (fn) => db.transaction(fn).immediate(),
    });
    app = express();
    app.use(express.json());
    app.use('/api/robots', createRobotsRoutes({ catalog, sessions }));
    app.use('/api/robots/:robotId', createGuardianRoutes(guardian));
    app.use(errorHandler);
  });

  const audit = () =>
    db.prepare('SELECT robot_id, event_code, state FROM audit_log ORDER BY id').all() as Array<{
      robot_id: number | null;
      event_code: string;
      state: string | null;
    }>;
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const createRobot = (body: unknown) =>
    request(app)
      .post('/api/robots')
      .send(body as object);
  const newSession = async (id: number): Promise<string> => {
    const res = await request(app).post(`/api/robots/${id}/sessions`);
    return (res.body as { sessionId: string }).sessionId;
  };
  const move = (id: number, body: unknown) =>
    request(app)
      .post(`/api/robots/${id}/move`)
      .send(body as object);

  describe('GET /api/robots y /api/robots/:robotId', () => {
    it('lista A1 y V2 con su estado actual, calidad y lastRequest', async () => {
      const res = await request(app).get('/api/robots');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({
        id: 1,
        name: 'Aspiradora A1',
        type: 'VACUUM',
        state: 'IDLE',
        position: START,
        positionQuality: 'RELIABLE',
        lastRequest: null,
      });
      expect(res.body[1]).toMatchObject({ id: 2, name: 'Vigilante V2', type: 'GUARD' });
    });

    it('GET /:robotId devuelve el robot; inexistente → 404 ROBOT_NOT_FOUND; id inválido → 422', async () => {
      const ok = await request(app).get('/api/robots/2');
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ id: 2, name: 'Vigilante V2', position: { x: 488, y: 290 } });
      const missing = await request(app).get('/api/robots/99');
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ code: 'ROBOT_NOT_FOUND', message: expect.any(String) });
      expect((await request(app).get('/api/robots/abc')).status).toBe(422);
    });
  });

  describe('POST /api/robots', () => {
    it('201 con el robot y su estado inicial IDLE / RELIABLE / (120, 90)', async () => {
      const res = await createRobot({ name: '  Robot Nuevo  ', type: 'GUARD' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: 3,
        name: 'Robot Nuevo',
        type: 'GUARD',
        state: 'IDLE',
        position: START,
        positionQuality: 'RELIABLE',
        lastRequest: null,
      });
      expect((await request(app).get('/api/robots/3')).status).toBe(200);
      expect((await request(app).get('/api/robots')).body).toHaveLength(3);
    });

    it('persiste el estado: el robot nuevo ya se puede mover con una sesión propia', async () => {
      await createRobot({ name: 'Robot Nuevo', type: 'VACUUM' });
      const sessionId = await newSession(3);
      const res = await move(3, { destination: FREE, sessionId, sequence: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ decision: 'AUTHORIZED', robotId: 3 });
    });

    it.each([
      [{}],
      [{ name: '', type: 'VACUUM' }],
      [{ name: '   ', type: 'VACUUM' }],
      [{ name: 'x'.repeat(61), type: 'VACUUM' }],
      [{ name: 'Ok', type: 'DRONE' }],
      [{ name: 'Ok' }],
      [{ name: 'Ok', type: 'GUARD', state: 'SAFE_STOP' }],
      [{ name: 'Ok', type: 'GUARD', position: { x: 1, y: 1 } }],
    ])('422 INVALID_ROBOT con el cuerpo %j y no crea nada', async (body) => {
      const res = await createRobot(body);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({ code: 'INVALID_ROBOT', message: expect.any(String) });
      expect(count('robots')).toBe(2);
    });

    it('nombre repetido → 409 ROBOT_NAME_DUPLICATE sin crear nada ni auditar', async () => {
      const res = await createRobot({ name: 'Aspiradora A1', type: 'VACUUM' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ code: 'ROBOT_NAME_DUPLICATE', message: expect.any(String) });
      expect(count('robots')).toBe(2);
      expect(audit()).toHaveLength(0);
    });

    it('"Sala" activa → 409 ROBOT_START_IN_RESTRICTED_ZONE y la fila de auditoría ya está confirmada', async () => {
      db.prepare("UPDATE zones SET active = 1 WHERE name = 'Sala'").run();
      const res = await createRobot({ name: 'Robot Nuevo', type: 'GUARD' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        code: 'ROBOT_START_IN_RESTRICTED_ZONE',
        message: expect.any(String),
      });
      // Se lee tras el 409 (Property 11).
      expect(audit()).toEqual([
        { robot_id: null, event_code: 'ROBOT_START_IN_RESTRICTED_ZONE', state: null },
      ]);
      expect(count('robots')).toBe(2);
      expect(count('robot_state')).toBe(2);
    });

    it('zonas no legibles → 409 ROBOT_START_NOT_VERIFIABLE con cause y auditoría (CA-03.35)', async () => {
      zonesDown = true;
      const res = await createRobot({ name: 'Robot Nuevo', type: 'GUARD' });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        code: 'ROBOT_START_NOT_VERIFIABLE',
        message: expect.any(String),
        cause: 'ZONE_DATA_UNAVAILABLE',
      });
      expect(audit()).toEqual([
        { robot_id: null, event_code: 'ROBOT_START_NOT_VERIFIABLE', state: null },
      ]);
      expect(count('robots')).toBe(2);
    });
  });

  describe('POST /api/robots/:robotId/sessions', () => {
    it('201 { sessionId } (UUID), audita SESSION_STARTED y la anterior queda invalidada', async () => {
      const first = await request(app).post('/api/robots/1/sessions');
      expect(first.status).toBe(201);
      expect(first.body).toEqual({
        sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(audit()).toEqual([{ robot_id: 1, event_code: 'SESSION_STARTED', state: 'IDLE' }]);

      const second = await request(app).post('/api/robots/1/sessions');
      expect(second.body.sessionId).not.toBe(first.body.sessionId);
      const stale = await move(1, {
        destination: FREE,
        sessionId: first.body.sessionId,
        sequence: 1,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('INVALID_SESSION');
    });

    it('robot inexistente → 404 ROBOT_NOT_FOUND', async () => {
      const res = await request(app).post('/api/robots/99/sessions');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROBOT_NOT_FOUND');
    });
  });

  describe('move con sesión (rutas por robot de la 002)', () => {
    it('INVALID_SESSION: 409 sin evaluar y con la fila de auditoría confirmada (Property 11)', async () => {
      await newSession(1);
      const res = await move(1, {
        destination: IN_STAIRS,
        sessionId: '99999999-9999-4999-8999-999999999999',
        sequence: 1,
      });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ code: 'INVALID_SESSION', message: expect.any(String) });
      expect(audit().filter((r) => r.event_code === 'INVALID_SESSION')).toEqual([
        { robot_id: 1, event_code: 'INVALID_SESSION', state: 'IDLE' },
      ]);
      expect((await request(app).get('/api/robots/1')).body).toMatchObject({
        state: 'IDLE',
        position: START,
      });
    });

    it('DUPLICATE_EVENT: 409, sin incidente nuevo y auditado; la última solicitud sigue siendo la primera', async () => {
      const sessionId = await newSession(1);
      const first = await move(1, { destination: IN_STAIRS, sessionId, sequence: 1 });
      expect(first.body.decision).toBe('DENIED');
      const again = await move(1, { destination: IN_STAIRS, sessionId, sequence: 1 });
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ code: 'DUPLICATE_EVENT', message: expect.any(String) });
      expect(count('incidents')).toBe(1);
      expect(audit().filter((r) => r.event_code === 'DUPLICATE_EVENT')).toHaveLength(1);
    });

    it('INVALID_MOVE_REQUEST: 422 con un cuerpo sin sessionId ni sequence', async () => {
      const res = await move(1, { destination: FREE });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_MOVE_REQUEST');
    });

    it('lastRequest aparece en GET /state (vía getLastRequest) y en GET /api/robots/:robotId', async () => {
      const sessionId = await newSession(2);
      await move(2, { destination: FREE, sessionId, sequence: 6 });
      const state = await request(app).get('/api/robots/2/state');
      expect(state.body.lastRequest).toEqual({
        sessionId,
        sequence: 6,
        destination: FREE,
        acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      const robot = await request(app).get('/api/robots/2');
      expect(robot.body.lastRequest).toEqual(state.body.lastRequest);
      expect((await request(app).get('/api/robots/1')).body.lastRequest).toBeNull();
    });
  });
});
