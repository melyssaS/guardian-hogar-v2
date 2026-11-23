import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createTestDb, readMovementLog } from '../helpers.js';

// Spec 003 — tarea 21. Contrato de API §5. Habitaciones del prototipo; robot en (120, 90).
describe('API /api/simulation', () => {
  let db: Db;
  let app: Express;
  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    app = createApp(db, { corsOrigins: ['http://localhost:5173'] });
  });

  const move = (body: unknown) =>
    request(app)
      .post('/api/simulation/move')
      .send(body as object);
  const robot = () => request(app).get('/api/simulation/robot');

  it('GET /robot devuelve estado y posición', async () => {
    const res = await robot();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'IDLE', position: { x: 120, y: 90 } });
  });

  it('CA-03.1 200 ALLOW y el robot queda en la nueva posición (IDLE)', async () => {
    const res = await move({ destination: { x: 450, y: 120 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      decision: 'ALLOW',
      state: 'MOVING',
      position: { x: 450, y: 120 },
      reason: 'Destination and trajectory are clear',
    });
    expect((await robot()).body).toEqual({
      state: 'IDLE',
      position: { x: 450, y: 120 },
    });
  });

  it('CA-03.2 200 PREVENTIVE_STOP con destino en zona; el robot no se mueve', async () => {
    const res = await move({ destination: { x: 100, y: 300 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      decision: 'PREVENTIVE_STOP',
      state: 'SAFE_STOP',
      position: { x: 120, y: 90 },
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      zoneName: 'Escaleras',
      reason: 'Destination is inside restricted zone: Escaleras',
    });
    expect((await robot()).body).toEqual({
      state: 'SAFE_STOP',
      position: { x: 120, y: 90 },
    });
  });

  it('CA-03.3 200 PREVENTIVE_STOP con TRAJECTORY_CROSSES_ZONE', async () => {
    const res = await move({ destination: { x: 110, y: 600 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      decision: 'PREVENTIVE_STOP',
      collisionType: 'TRAJECTORY_CROSSES_ZONE',
      zoneName: 'Escaleras',
      position: { x: 120, y: 90 },
    });
  });

  it('CA-03.4 409 SAFE_STOP_ACTIVE con el MoveResult en el cuerpo', async () => {
    await move({ destination: { x: 100, y: 300 } });
    const res = await move({ destination: { x: 450, y: 120 } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      decision: 'DENIED_SAFE_STOP',
      code: 'SAFE_STOP_ACTIVE',
      state: 'SAFE_STOP',
      position: { x: 120, y: 90 },
      reason: 'Robot is in SAFE_STOP; movement denied',
    });
  });

  it('CA-03.5 422 DESTINATION_OUT_OF_BOUNDS y el robot no cambia', async () => {
    const res = await move({ destination: { x: 1000.5, y: 10 } });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      code: 'DESTINATION_OUT_OF_BOUNDS',
      message: expect.any(String),
    });
    expect((await robot()).body).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
    });
  });

  it('acepta el borde del plano (inclusivo)', async () => {
    const res = await move({ destination: { x: 1000, y: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('ALLOW');
  });

  it.each([
    [{}],
    [{ destination: { x: '1', y: 2 } }],
    [{ destination: { x: 1 } }],
    [{ origin: { x: 0, y: 0 } }],
    [[]],
  ])('RNF-01 422 INVALID_DESTINATION con payload %j', async (body) => {
    const res = await move(body);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      code: 'INVALID_DESTINATION',
      message: expect.any(String),
    });
  });

  it('el cliente no puede imponer el origen (RF-02.1)', async () => {
    // Un origen enviado se ignora: se evalúa desde la posición del servidor.
    const res = await move({
      destination: { x: 100, y: 300 },
      origin: { x: 100, y: 300 },
    });
    expect(res.body.collisionType).toBe('RESTRICTED_ZONE_VIOLATION');
    expect(res.body.position).toEqual({ x: 120, y: 90 });
  });

  it('RNF-04 JSON mal formado → 400 sin stack trace', async () => {
    const res = await request(app)
      .post('/api/simulation/move')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(js|ts)/);
  });

  it('DD-106 POST /reset libera SAFE_STOP → IDLE conservando la posición', async () => {
    await move({ destination: { x: 100, y: 300 } });
    const res = await request(app).post('/api/simulation/reset');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'IDLE', position: { x: 120, y: 90 } });
    expect((await move({ destination: { x: 450, y: 120 } })).status).toBe(200);
  });

  it('CA-03.8 cada evaluación queda en movement_log; los 422 no', async () => {
    await move({ destination: { x: 450, y: 120 } });
    await move({ destination: { x: 100, y: 600 } });
    await move({ destination: { x: 10, y: 10 } });
    await move({ destination: { x: -1, y: 10 } });
    await move({});
    expect(readMovementLog(db).map((r) => [r.decision, r.state_after, r.collision_type])).toEqual([
      ['ALLOW', 'MOVING', null],
      ['PREVENTIVE_STOP', 'SAFE_STOP', 'TRAJECTORY_CROSSES_ZONE'],
      ['DENIED_SAFE_STOP', 'SAFE_STOP', null],
    ]);
  });

  it('RNF-06 misma solicitud con el mismo estado → misma decisión', async () => {
    const a = await move({ destination: { x: 100, y: 300 } });
    await request(app).post('/api/simulation/reset');
    const b = await move({ destination: { x: 100, y: 300 } });
    expect(b.body).toEqual(a.body);
  });
});
