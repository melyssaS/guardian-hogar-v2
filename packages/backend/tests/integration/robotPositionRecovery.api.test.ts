import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createTestDb } from '../helpers.js';

// Spec 002 — tarea 27 (fase VERIFICAR). Property 10 / PD-09 (design §5b): una lectura confiable
// habilita el movimiento tras una señal de pérdida explícita. Requisitos 8.1, 8.3.
//
// Cadena demostrada contra los endpoints reales (/api/robot §6):
//   1. estado base: IDLE, (120,90), RELIABLE
//   2. señal de pérdida explícita: POST /position { MISSING } → positionQuality MISSING (R6.2/R8)
//   3. con MISSING el move se DENIEGA por datos (MISSING_POSITION, DENIED, 200) → no mueve a ciegas
//   4. lectura confiable: POST /position { RELIABLE } → positionQuality RELIABLE
//   5. desde DEGRADED (consecuencia de la denegación por datos) el move se rechaza con
//      SAFE_STOP_ACTIVE (409) hasta recuperar: POST /recover → IDLE (posición segura + RELIABLE)
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

  // Origen sembrado y destino libre (fuera de Escaleras y Cuarto del bebé, las zonas activas).
  const ORIGIN = { x: 120, y: 90 };
  const FREE_DESTINATION = { x: 450, y: 120 };

  it('R8.3 / Property 10: tras la pérdida y una lectura RELIABLE, un move a destino libre se autoriza', async () => {
    // 1. Estado base: el seed deja RELIABLE/IDLE en (120,90).
    const baseline = await state();
    expect(baseline.status).toBe(200);
    expect(baseline.body).toEqual({
      state: 'IDLE',
      position: ORIGIN,
      positionQuality: 'RELIABLE',
    });

    // 2. Señal de pérdida explícita (R6.2/R8): la calidad pasa a MISSING; el estado no cambia.
    const loss = await position({ position: ORIGIN, quality: 'MISSING' });
    expect(loss.status).toBe(200);
    expect(loss.body).toEqual({
      state: 'IDLE',
      position: ORIGIN,
      positionQuality: 'MISSING',
    });
    expect((await state()).body.positionQuality).toBe('MISSING');

    // 3. Con MISSING el robot no puede moverse a ciegas: denegación por datos (no rechazo por
    //    estado). DENIED → 200 con la decisión en el cuerpo; el robot queda en DEGRADED sin moverse.
    const blind = await move({ destination: FREE_DESTINATION });
    expect(blind.status).toBe(200);
    expect(blind.body).toMatchObject({
      decision: 'DENIED',
      code: 'MISSING_POSITION',
      state: 'DEGRADED',
      position: ORIGIN,
    });
    expect((await state()).body).toMatchObject({
      state: 'DEGRADED',
      position: ORIGIN,
      positionQuality: 'MISSING',
    });

    // 4. Lectura confiable: fija la calidad en RELIABLE sin evaluar geometría ni cambiar el estado.
    const reliable = await position({ position: ORIGIN, quality: 'RELIABLE' });
    expect(reliable.status).toBe(200);
    expect(reliable.body).toEqual({
      state: 'DEGRADED',
      position: ORIGIN,
      positionQuality: 'RELIABLE',
    });
    expect((await state()).body.positionQuality).toBe('RELIABLE');

    // 5a. La máquina de estados exige recuperar antes de moverse: desde DEGRADED el move se
    //     rechaza por estado (SAFE_STOP_ACTIVE → 409), no por datos.
    const rejected = await move({ destination: FREE_DESTINATION });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      decision: 'REJECTED',
      code: 'SAFE_STOP_ACTIVE',
      state: 'DEGRADED',
      position: ORIGIN,
    });

    // 5b. Recuperación explícita: posición segura (fuera de toda zona) + RELIABLE → IDLE (R4).
    const recovered = await recover();
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual({
      recovered: true,
      state: 'IDLE',
      position: ORIGIN,
    });

    // 6. El movimiento a destino libre se AUTORIZA: el robot llega al destino y queda IDLE
    //    (MOVING transitorio se completa en la misma solicitud). No hay bloqueo permanente (PD-09).
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
});
