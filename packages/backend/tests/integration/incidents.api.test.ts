import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';
import { createIncidentRoutes } from '../../src/routes/incidentRoutes.js';
import { createTestDb } from '../helpers.js';

// Spec 002 — RC-14 (R5.5-R5.7): GET /api/incidents y /api/incidents/:id sobre una app de prueba
// que monta solo estas rutas (el montaje en app.ts es RC-17b).

const STAIRS = {
  id: 1,
  name: 'Escaleras',
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  active: true,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('API /api/incidents (contrato por robot)', () => {
  let db: Db;
  let app: Express;

  beforeEach(() => {
    db = createTestDb();
    app = express();
    app.use(
      '/api/incidents',
      createIncidentRoutes(createIncidentRepository(db), createRobotCatalogRepository(db)),
    );
    app.use(errorHandler);
  });

  function seed(robotId: number, reason: string) {
    return createIncidentRepository(db).create({
      robotId,
      rule: 'R-ZONA-01',
      zoneName: 'Escaleras',
      decisionCode: 'TRAJECTORY_CROSSES_ZONE',
      collisionType: 'TRAJECTORY_CROSSES_ZONE',
      stateAfter: 'SAFE_STOP',
      origin: { x: 120, y: 90 },
      destination: { x: 110, y: 400 },
      zonesSnapshot: [STAIRS],
      reason,
    });
  }

  it('lista vacía al inicio', async () => {
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('lista del más reciente al más antiguo con robot, regla y zona, sin zonesSnapshot', async () => {
    seed(1, 'primero');
    seed(2, 'segundo');
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(200);
    expect(res.body.map((i: { reason: string }) => i.reason)).toEqual(['segundo', 'primero']);
    expect(res.body[0]).toEqual({
      id: 2,
      robotId: 2,
      robotName: 'Vigilante V2',
      rule: 'R-ZONA-01',
      zoneName: 'Escaleras',
      decisionCode: 'TRAJECTORY_CROSSES_ZONE',
      collisionType: 'TRAJECTORY_CROSSES_ZONE',
      stateAfter: 'SAFE_STOP',
      origin: { x: 120, y: 90 },
      destination: { x: 110, y: 400 },
      reason: 'segundo',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('?robotId= filtra por robot', async () => {
    seed(1, 'a1');
    seed(2, 'v2');
    const res = await request(app).get('/api/incidents').query({ robotId: 2 });
    expect(res.status).toBe(200);
    expect(res.body.map((i: { reason: string }) => i.reason)).toEqual(['v2']);
  });

  it('?robotId= de un robot inexistente → 404 ROBOT_NOT_FOUND', async () => {
    const res = await request(app).get('/api/incidents').query({ robotId: 99 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'ROBOT_NOT_FOUND', message: expect.any(String) });
  });

  it('?robotId= inválido → 422 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/incidents').query({ robotId: 'abc' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('GET /:id devuelve el detalle con zonesSnapshot', async () => {
    seed(1, 'detalle');
    const res = await request(app).get('/api/incidents/1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, robotName: 'Aspiradora A1', reason: 'detalle' });
    expect(res.body.zonesSnapshot).toEqual([STAIRS]);
  });

  it('GET /:id inexistente → 404 INCIDENT_NOT_FOUND', async () => {
    const res = await request(app).get('/api/incidents/99');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'INCIDENT_NOT_FOUND', message: expect.any(String) });
  });

  it('GET /:id con id inválido → 422 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/incidents/abc');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('los incidentes anteriores al refuerzo salen con robotId y robotName nulos y rule derivada', async () => {
    db.prepare(
      `INSERT INTO incidents (decision_code, collision_type, state_after, origin_x, origin_y, dest_x, dest_y, zones_snapshot, reason, created_at)
       VALUES ('RESTRICTED_ZONE_VIOLATION', 'RESTRICTED_ZONE_VIOLATION', 'SAFE_STOP', 1, 2, 3, 4, '[]', 'antiguo', '2025-03-04 05:06:07')`,
    ).run();
    const res = await request(app).get('/api/incidents');
    expect(res.body[0]).toMatchObject({
      robotId: null,
      robotName: null,
      rule: 'R-ZONA-01',
      zoneName: null,
      createdAt: '2025-03-04T05:06:07.000Z',
    });
  });

  it('es de solo lectura: POST/PUT/DELETE no existen (append-only)', async () => {
    const res = await request(app).delete('/api/incidents/1');
    expect(res.status).toBe(404);
  });
});
