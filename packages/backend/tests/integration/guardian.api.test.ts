import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createGuardianRoutes } from '../../src/routes/guardianRoutes.js';
import { createGuardianService } from '../../src/services/guardianService.js';
import type { SessionService } from '../../src/services/sessionService.js';
import { createTestDb, createTestSessions } from '../helpers.js';

// Spec 002 — RC-16 (R1.8, R1.9, R11.1-R11.6, R12.3, R12.4, R5.8, Property 14, 15, 16): API por
// robot /api/robots/:robotId/{state,move,recover,position} sobre una app de prueba que monta solo
// `guardianRoutes` (el montaje en app.ts es RC-17b). Las sesiones las inicia `sessionService`
// directamente (su ruta `/sessions` es de la spec 003).

const HOME = { x: 120, y: 90 };
const FREE = { x: 450, y: 120 };
const IN_STAIRS = { x: 100, y: 300 };
const UNKNOWN_SESSION = '99999999-9999-4999-8999-999999999999';

describe('API /api/robots/:robotId (vigilante por robot)', () => {
  let db: Db;
  let app: Express;
  let sessions: SessionService;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    const zones = createZoneRepository(db);
    sessions = createTestSessions(db);
    const service = createGuardianService({
      robots: createRobotRepository(db),
      incidents: createIncidentRepository(db),
      audit: createAuditLogRepository(db),
      transitions: createTransitionLogRepository(db),
      sessions,
      getActiveZones: () => zones.findAll('active'),
      runInTransaction: (fn) => db.transaction(fn)(),
      pad: 0,
    });
    app = express();
    app.use(express.json());
    app.use('/api/robots/:robotId', createGuardianRoutes(service));
    app.use(errorHandler);
  });

  const state = (id: number | string) => request(app).get(`/api/robots/${id}/state`);
  const move = (id: number | string, body: unknown) =>
    request(app)
      .post(`/api/robots/${id}/move`)
      .send(body as object);
  const recover = (id: number | string) => request(app).post(`/api/robots/${id}/recover`);
  const position = (id: number | string, body: unknown) =>
    request(app)
      .post(`/api/robots/${id}/position`)
      .send(body as object);
  const audit = () =>
    db.prepare('SELECT robot_id, event_code, state FROM audit_log ORDER BY id').all() as Array<{
      robot_id: number | null;
      event_code: string;
      state: string | null;
    }>;

  describe('GET /state', () => {
    it('devuelve robotId, state, position, positionQuality y lastRequest nulo', async () => {
      const res = await state(1);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        robotId: 1,
        state: 'IDLE',
        position: HOME,
        positionQuality: 'RELIABLE',
        lastRequest: null,
      });
    });

    it('lastRequest refleja la última solicitud aceptada (vía getLastRequest)', async () => {
      const { sessionId } = sessions.startSession(1);
      await move(1, { destination: FREE, sessionId, sequence: 4 });
      const res = await state(1);
      expect(res.body.lastRequest).toEqual({
        sessionId,
        sequence: 4,
        destination: FREE,
        acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      expect(res.body.position).toEqual(FREE);
    });

    it('robot inexistente → 404 ROBOT_NOT_FOUND; id no numérico → 422', async () => {
      const missing = await state(99);
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ code: 'ROBOT_NOT_FOUND', message: expect.any(String) });
      expect((await state('abc')).status).toBe(422);
      expect((await state(0)).status).toBe(422);
    });
  });

  describe('POST /move', () => {
    it('R11.2 cuerpo inválido → 422 INVALID_MOVE_REQUEST', async () => {
      const { sessionId } = sessions.startSession(1);
      const bodies: unknown[] = [
        {},
        { destination: FREE },
        { destination: FREE, sessionId },
        { destination: FREE, sessionId: 'no-uuid', sequence: 1 },
        { destination: FREE, sessionId, sequence: 0 },
        { destination: FREE, sessionId, sequence: 1.5 },
        { destination: { x: 'a', y: 1 }, sessionId, sequence: 1 },
      ];
      for (const body of bodies) {
        const res = await move(1, body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body).toEqual({ code: 'INVALID_MOVE_REQUEST', message: expect.any(String) });
      }
    });

    it('R11.5 Zod antes que el 404: cuerpo inválido sobre un robot inexistente → 422', async () => {
      expect((await move(99, {})).status).toBe(422);
    });

    it('R11.5 robot inexistente con cuerpo válido → 404 ROBOT_NOT_FOUND', async () => {
      const res = await move(99, { destination: FREE, sessionId: UNKNOWN_SESSION, sequence: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROBOT_NOT_FOUND');
    });

    it('R11.5 fuera del plano → 422 DESTINATION_OUT_OF_BOUNDS antes que la sesión', async () => {
      const res = await move(1, {
        destination: { x: 5000, y: 1 },
        sessionId: UNKNOWN_SESSION,
        sequence: 1,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('DESTINATION_OUT_OF_BOUNDS');
      expect(audit()).toHaveLength(0);
    });

    it('R11.3 sesión inválida → 409 { code, message } con la fila de auditoría ya confirmada', async () => {
      sessions.startSession(1);
      const before = audit().length;
      const res = await move(1, {
        destination: IN_STAIRS,
        sessionId: UNKNOWN_SESSION,
        sequence: 1,
      });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ code: 'INVALID_SESSION', message: expect.any(String) });
      // La fila se lee DESPUÉS del 409 (Property 16) y el estado no cambió.
      expect(audit().slice(before)).toEqual([
        { robot_id: 1, event_code: 'INVALID_SESSION', state: 'IDLE' },
      ]);
      expect((await state(1)).body).toMatchObject({ state: 'IDLE', position: HOME });
      expect(db.prepare('SELECT COUNT(*) AS n FROM incidents').get()).toEqual({ n: 0 });
    });

    it('R11.4 secuencia repetida → 409 DUPLICATE_EVENT, sin incidente nuevo y auditada (Property 14)', async () => {
      const { sessionId } = sessions.startSession(1);
      const first = await move(1, { destination: IN_STAIRS, sessionId, sequence: 7 });
      expect(first.status).toBe(200);
      expect(first.body.decision).toBe('DENIED');

      const again = await move(1, { destination: IN_STAIRS, sessionId, sequence: 7 });
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ code: 'DUPLICATE_EVENT', message: expect.any(String) });
      expect((await request(app).get('/api/robots/1/state')).body.lastRequest.sequence).toBe(7);
      expect(db.prepare('SELECT COUNT(*) AS n FROM incidents').get()).toEqual({ n: 1 });
      expect(audit().filter((r) => r.event_code === 'DUPLICATE_EVENT')).toEqual([
        { robot_id: 1, event_code: 'DUPLICATE_EVENT', state: 'SAFE_STOP' },
      ]);
    });

    it('AUTHORIZED → 200 con robotId y positionQuality', async () => {
      const { sessionId } = sessions.startSession(1);
      const res = await move(1, { destination: FREE, sessionId, sequence: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        decision: 'AUTHORIZED',
        state: 'IDLE',
        position: FREE,
        robotId: 1,
        positionQuality: 'RELIABLE',
      });
    });

    it('DENIED → 200 con robotId, positionQuality, rule, zoneName e incidentId', async () => {
      const { sessionId } = sessions.startSession(1);
      const res = await move(1, { destination: IN_STAIRS, sessionId, sequence: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        decision: 'DENIED',
        code: 'RESTRICTED_ZONE_VIOLATION',
        collisionType: 'RESTRICTED_ZONE_VIOLATION',
        state: 'SAFE_STOP',
        position: HOME,
        robotId: 1,
        positionQuality: 'RELIABLE',
        rule: 'R-ZONA-01',
        zoneName: 'Escaleras',
        incidentId: expect.any(Number),
        reason: expect.any(String),
      });
    });

    it('REJECTED por estado → 409 con el cuerpo de decisión y robotId/positionQuality', async () => {
      const { sessionId } = sessions.startSession(1);
      await move(1, { destination: IN_STAIRS, sessionId, sequence: 1 });
      const res = await move(1, { destination: FREE, sessionId, sequence: 2 });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        decision: 'REJECTED',
        code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        position: HOME,
        robotId: 1,
        positionQuality: 'RELIABLE',
        reason: expect.any(String),
      });
      expect(audit().filter((r) => r.event_code === 'SAFE_STOP_ACTIVE')).toHaveLength(1);
    });
  });

  describe('POST /recover y /position por robot', () => {
    it('recover: 200 con robotId y transitioned; 409 RECOVERY_NOT_ALLOWED con cause', async () => {
      db.prepare(
        "UPDATE robot_state SET state = 'SAFE_STOP', pos_x = 100, pos_y = 300 WHERE robot_id = 2",
      ).run();
      const blocked = await recover(2);
      expect(blocked.status).toBe(409);
      expect(blocked.body).toEqual({
        code: 'RECOVERY_NOT_ALLOWED',
        cause: 'UNSAFE_POSITION',
        message: expect.any(String),
      });

      db.prepare('UPDATE robot_state SET pos_x = 488, pos_y = 290 WHERE robot_id = 2').run();
      const ok = await recover(2);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({
        robotId: 2,
        state: 'IDLE',
        position: { x: 488, y: 290 },
        positionQuality: 'RELIABLE',
        transitioned: true,
      });
      expect((await recover(2)).body.transitioned).toBe(false);
    });

    it('recover sobre un robot inexistente → 404', async () => {
      expect((await recover(99)).status).toBe(404);
    });

    it('position: pérdida → 200 DEGRADED; lectura no coincidente → 409 POSITION_CONFLICT', async () => {
      const loss = await position(2, { position: { x: 488, y: 290 }, quality: 'MISSING' });
      expect(loss.status).toBe(200);
      expect(loss.body).toEqual({
        state: 'DEGRADED',
        position: { x: 488, y: 290 },
        positionQuality: 'MISSING',
      });
      const conflict = await position(2, { position: HOME, quality: 'RELIABLE' });
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('POSITION_CONFLICT');
      expect(
        audit()
          .filter((r) => r.robot_id === 2)
          .map((r) => r.event_code),
      ).toEqual(['POSITION_READING', 'POSITION_CONFLICT']);
    });

    it('position con payload inválido → 422 INVALID_POSITION; robot inexistente → 404', async () => {
      const bad = await position(1, { position: { x: 1 }, quality: 'RELIABLE' });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('INVALID_POSITION');
      expect((await position(99, { position: HOME, quality: 'MISSING' })).status).toBe(404);
    });
  });

  describe('Property 15: aislamiento entre robots', () => {
    it('denegar a V2 no cambia el estado, la posición ni la sesión de A1', async () => {
      const a = sessions.startSession(1).sessionId;
      const b = sessions.startSession(2).sessionId;
      const before = (await state(1)).body;

      const denied = await move(2, { destination: IN_STAIRS, sessionId: b, sequence: 1 });
      expect(denied.body).toMatchObject({ decision: 'DENIED', robotId: 2 });

      expect((await state(1)).body).toEqual(before);
      expect((await state(2)).body).toMatchObject({ state: 'SAFE_STOP', robotId: 2 });
      // La sesión de V2 no sirve para A1 y la de A1 sigue vigente.
      expect((await move(1, { destination: FREE, sessionId: b, sequence: 1 })).body.code).toBe(
        'INVALID_SESSION',
      );
      expect((await move(1, { destination: FREE, sessionId: a, sequence: 1 })).body.decision).toBe(
        'AUTHORIZED',
      );
      // El incidente es de V2.
      expect(db.prepare('SELECT robot_id FROM incidents').all()).toEqual([{ robot_id: 2 }]);
    });
  });

  it('las rutas antiguas /api/robot/* no existen en esta app de prueba (solo por robot)', async () => {
    expect((await request(app).get('/api/robot/state')).status).toBe(404);
  });
});
