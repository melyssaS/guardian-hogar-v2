import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createTestDb } from '../helpers.js';

// Spec 002 — tarea 15. Prueba de cableado mínima de /api/robot y /api/incidents (§6, §8.1).
// La batería completa de integración es la tarea 23; aquí solo se verifica el montaje.
describe('API /api/robot — cableado (spec 002 §6)', () => {
  let db: Db;
  let app: Express;
  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    app = createApp(db, { corsOrigins: ['http://localhost:5173'] });
  });

  it('GET /api/robot/state responde 200 con { state, position, positionQuality }', async () => {
    const res = await request(app).get('/api/robot/state');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
  });

  it('GET /api/incidents responde 200 con un arreglo', async () => {
    const res = await request(app).get('/api/incidents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// Spec 002 — RC-17b (R10.6, R12.3, R5.6; decisión 2): montaje ADITIVO en `app.ts`, solo en la rama de
// trabajo. `/api/robots` (catálogo, sesiones y rutas por robot) y el `/api/incidents` nuevo
// responden junto a `/api/simulation/*` y `/api/robot/*`, que siguen operativos hasta RC-20.
describe('app.ts — montaje aditivo de /api/robots (spec 002 RC-17b)', () => {
  let db: Db;
  let app: Express;
  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    app = createApp(db, { corsOrigins: ['http://localhost:5173'] });
  });

  const IN_STAIRS = { x: 100, y: 300 };

  it('las rutas nuevas responden en la app real', async () => {
    const list = await request(app).get('/api/robots');
    expect(list.status).toBe(200);
    expect(list.body.map((r: { name: string }) => r.name)).toEqual([
      'Aspiradora A1',
      'Vigilante V2',
    ]);
    expect((await request(app).get('/api/robots/1')).status).toBe(200);
    expect((await request(app).get('/api/robots/1/state')).body).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
      lastRequest: null,
    });
    const session = await request(app).post('/api/robots/1/sessions');
    expect(session.status).toBe(201);
    const move = await request(app)
      .post('/api/robots/1/move')
      .send({ destination: IN_STAIRS, sessionId: session.body.sessionId, sequence: 1 });
    expect(move.status).toBe(200);
    expect(move.body).toMatchObject({ decision: 'DENIED', robotId: 1, rule: 'R-ZONA-01' });
    expect((await request(app).post('/api/robots/1/recover')).status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/robots/1/position')
          .send({ position: { x: 120, y: 90 }, quality: 'RELIABLE' })
      ).status,
    ).toBe(200);
    const created = await request(app).post('/api/robots').send({ name: 'Nuevo', type: 'GUARD' });
    expect(created.status).toBe(201);
    expect((await request(app).get(`/api/robots/${created.body.id}/state`)).status).toBe(200);
  });

  it('/api/incidents usa el contrato nuevo: robot, regla, zona, más reciente primero y detalle', async () => {
    const { sessionId } = (await request(app).post('/api/robots/2/sessions')).body;
    const denied = await request(app)
      .post('/api/robots/2/move')
      .send({ destination: IN_STAIRS, sessionId, sequence: 1 });
    const list = await request(app).get('/api/incidents').query({ robotId: 2 });
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({
      id: denied.body.incidentId,
      robotId: 2,
      robotName: 'Vigilante V2',
      rule: 'R-ZONA-01',
      zoneName: 'Escaleras',
    });
    const detail = await request(app).get(`/api/incidents/${denied.body.incidentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.zonesSnapshot.length).toBeGreaterThan(0);
    expect((await request(app).get('/api/incidents/9999')).status).toBe(404);
    expect((await request(app).get('/api/incidents').query({ robotId: 99 })).status).toBe(404);
  });

  it('las rutas antiguas siguen operativas junto a las nuevas', async () => {
    expect((await request(app).get('/api/simulation/robot')).status).toBe(200);
    expect((await request(app).get('/api/robot/state')).status).toBe(200);
    const legacyMove = await request(app)
      .post('/api/simulation/move')
      .send({ destination: { x: 450, y: 120 } });
    expect(legacyMove.status).toBe(200);
    expect((await request(app).get('/api/zones')).status).toBe(200);
  });

  it('un único estado: el robot movido por la ruta antigua se ve en la nueva (mismo vigilante)', async () => {
    const legacy = await request(app).post('/api/robot/move').send({ destination: IN_STAIRS });
    expect(legacy.body).toMatchObject({ decision: 'DENIED' });
    const state = await request(app).get('/api/robots/1/state');
    expect(state.body).toMatchObject({ state: 'SAFE_STOP', position: { x: 120, y: 90 } });
    // El incidente de la ruta antigua se lista en el contrato nuevo con su robot.
    const incidents = await request(app).get('/api/incidents');
    expect(incidents.body).toHaveLength(1);
    expect(incidents.body[0]).toMatchObject({ robotId: 1, rule: 'R-ZONA-01' });
  });

  it('una ruta desconocida bajo /api sigue respondiendo 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/robots/1/unknown');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Route not found' });
  });

  it('el arranque seguro de la app real cubre a todos los robots (T8 por robot)', async () => {
    db.prepare("UPDATE robot_state SET state = 'MOVING' WHERE robot_id = 2").run();
    const { bootstrap } = await import('../../src/db/bootstrap.js');
    bootstrap(db);
    expect((await request(app).get('/api/robots/2/state')).body.state).toBe('SAFE_STOP');
    expect((await request(app).get('/api/robots/1/state')).body.state).toBe('IDLE');
  });
});
