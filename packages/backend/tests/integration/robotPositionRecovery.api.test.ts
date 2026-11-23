import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createTestDb } from '../helpers.js';

// Spec 002 — tarea 27 (Property 10 / PD-09) con el contrato RC-13 (R3.6, R5.11, R8.5-R8.7): una
// señal de pérdida explícita lleva el robot a DEGRADED con un incidente R-SIGNAL-01; una lectura
// RELIABLE coincidente restablece la calidad (nunca relocaliza), y tras `recover` el movimiento a
// destino libre se AUTORIZA (R8.1, R8.3).
//
// Cadena demostrada contra los endpoints reales (/api/robot §6):
//   1. estado base: IDLE, (120,90), RELIABLE
//   2. POST /position { MISSING } → 200, DEGRADED, calidad MISSING e incidente R-SIGNAL-01
//   3. con el robot en DEGRADED el move se rechaza por estado (409 SAFE_STOP_ACTIVE)
//   4. POST /position { RELIABLE } coincidente → solo calidad; no coincidente → 409 POSITION_CONFLICT
//   5. POST /recover → IDLE (posición segura + RELIABLE)
//   6. move a destino libre → AUTHORIZED, IDLE, robot en el destino: no hay bloqueo permanente.
describe('API /api/robot — habilitación por lectura de posición (PD-09)', () => {
  let db: Db;
  let app: Express;
  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    app = createApp(db, { corsOrigins: ['http://localhost:5173'] });
  });

  const state = () => request(app).get('/api/robot/state');
  const move = (body: unknown) =>
    request(app)
      .post('/api/robot/move')
      .send(body as object);
  const position = (body: unknown) =>
    request(app)
      .post('/api/robot/position')
      .send(body as object);
  const recover = () => request(app).post('/api/robot/recover');
  const audit = () =>
    db.prepare('SELECT robot_id, event_code, state FROM audit_log ORDER BY id').all();

  // Origen sembrado y destino libre (fuera de Escaleras y Cuarto del bebé, las zonas activas).
  const ORIGIN = { x: 120, y: 90 };
  const FREE_DESTINATION = { x: 450, y: 120 };

  it('R8.3 / Property 10: tras la pérdida, una lectura RELIABLE coincidente y recover, un move a destino libre se autoriza', async () => {
    // 1. Estado base: el seed deja RELIABLE/IDLE en (120,90).
    expect((await state()).body).toEqual({
      state: 'IDLE',
      position: ORIGIN,
      positionQuality: 'RELIABLE',
    });

    // 2. Señal de pérdida explícita (R6.2/R8.6): la calidad pasa a MISSING y el robot a DEGRADED
    //    (T5, R3.6) con un incidente R-SIGNAL-01 (R5.11). La posición recibida no relocaliza.
    const loss = await position({ position: { x: 300, y: 100 }, quality: 'MISSING' });
    expect(loss.status).toBe(200);
    expect(loss.body).toEqual({
      state: 'DEGRADED',
      position: ORIGIN,
      positionQuality: 'MISSING',
    });
    const incidents = await request(app).get('/api/incidents');
    expect(incidents.body).toHaveLength(1);
    expect(incidents.body[0]).toMatchObject({
      robotId: 1,
      rule: 'R-SIGNAL-01',
      decisionCode: 'POSITION_QUALITY_LOST',
      stateAfter: 'DEGRADED',
      zoneName: null,
      origin: ORIGIN,
      destination: ORIGIN,
    });

    // 3. En DEGRADED el move se rechaza por estado (SAFE_STOP_ACTIVE → 409), no por datos.
    const rejected = await move({ destination: FREE_DESTINATION });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      decision: 'REJECTED',
      code: 'SAFE_STOP_ACTIVE',
      state: 'DEGRADED',
      position: ORIGIN,
    });

    // 4a. Una lectura RELIABLE que no coincide con la posición actual NO relocaliza: 409
    //     POSITION_CONFLICT, sin cambios y con la fila de auditoría ya confirmada.
    const conflict = await position({ position: FREE_DESTINATION, quality: 'RELIABLE' });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ code: 'POSITION_CONFLICT', message: expect.any(String) });
    expect((await state()).body).toEqual({
      state: 'DEGRADED',
      position: ORIGIN,
      positionQuality: 'MISSING',
    });
    expect(audit().map((r) => (r as { event_code: string }).event_code)).toContain(
      'POSITION_CONFLICT',
    );

    // 4b. Fuera del plano: 422 POSITION_OUT_OF_BOUNDS.
    const outside = await position({ position: { x: 5000, y: 5 }, quality: 'RELIABLE' });
    expect(outside.status).toBe(422);
    expect(outside.body.code).toBe('POSITION_OUT_OF_BOUNDS');

    // 4c. Lectura coincidente: solo cambia la calidad; el estado sigue en DEGRADED.
    const reliable = await position({ position: ORIGIN, quality: 'RELIABLE' });
    expect(reliable.status).toBe(200);
    expect(reliable.body).toEqual({
      state: 'DEGRADED',
      position: ORIGIN,
      positionQuality: 'RELIABLE',
    });

    // 5. Recuperación explícita: posición segura (fuera de toda zona) + RELIABLE → IDLE (R4).
    const recovered = await recover();
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: ORIGIN,
      positionQuality: 'RELIABLE',
      transitioned: true,
    });

    // 6. El movimiento a destino libre se AUTORIZA y no hay bloqueo permanente (PD-09).
    const authorized = await move({ destination: FREE_DESTINATION });
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({
      decision: 'AUTHORIZED',
      state: 'IDLE',
      position: FREE_DESTINATION,
    });
    expect((await state()).body).toEqual({
      state: 'IDLE',
      position: FREE_DESTINATION,
      positionQuality: 'RELIABLE',
    });
  });

  it('un payload inválido sigue siendo 422 INVALID_POSITION y no cambia nada (R8.2)', async () => {
    const res = await position({ position: { x: 'a', y: 1 }, quality: 'RELIABLE' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_POSITION');
    const bad = await position({ position: ORIGIN, quality: 'PERFECT' });
    expect(bad.status).toBe(422);
    expect((await state()).body.positionQuality).toBe('RELIABLE');
  });
});
