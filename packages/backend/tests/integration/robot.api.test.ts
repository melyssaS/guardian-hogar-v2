import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createTestDb } from '../helpers.js';

/**
 * Spec 002 — tarea 23 (MADA · VERIFICAR). Pruebas de integración del vigilante de seguridad.
 *
 * Contrato de API §6 (mapeo decisión → HTTP), R3.3 (rechazo por estado sin efectos) y R5.1/R5.4
 * (incidentes append-only). Habitaciones del prototipo sembradas con `seedDefaultRooms`; robot
 * sembrado en IDLE, posición (120, 90), calidad RELIABLE (migración 005, R6.1).
 *
 * Zonas activas del prototipo: Escaleras (29, 226, 160, 178) → AABB [29..189]×[226..404] y
 * Cuarto del bebé (206, 226, 187, 178) → AABB [206..393]×[226..404]. El origen (120, 90) y el
 * destino libre (450, 120) quedan fuera de ambas; (100, 300) cae dentro de Escaleras.
 *
 * Las aserciones reflejan las formas reales que produce `guardianService` y que `robotController`
 * deja pasar sin transformar (AUTHORIZED/DENIED → 200, REJECTED → 409, payload inválido → 422).
 */
describe('API /api/robot', () => {
  let db: Db;
  let app: Express;
  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    app = createApp(db, { corsOrigins: ['http://localhost:5173'] });
  });

  const move = (body: unknown) =>
    request(app)
      .post('/api/robot/move')
      .send(body as object);
  const state = () => request(app).get('/api/robot/state');
  const recover = () => request(app).post('/api/robot/recover');
  const incidents = () => request(app).get('/api/incidents');

  // ── Estado ────────────────────────────────────────────────────────────────
  describe('GET /state', () => {
    it('devuelve estado, posición y calidad de posición sembrados', async () => {
      const res = await state();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
      });
    });
  });

  // ── Move: 200 AUTHORIZED ────────────────────────────────────────────────────
  describe('POST /move — 200 AUTHORIZED', () => {
    it('autoriza un destino libre; MOVING es transitorio y el robot queda IDLE en el destino', async () => {
      const res = await move({ destination: { x: 450, y: 120 } });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        decision: 'AUTHORIZED',
        state: 'IDLE',
        position: { x: 450, y: 120 },
      });
      // GET /state confirma la persistencia: IDLE en (450, 120), listo para el siguiente move.
      expect((await state()).body).toEqual({
        state: 'IDLE',
        position: { x: 450, y: 120 },
        positionQuality: 'RELIABLE',
      });
    });
  });

  // ── Move: 200 DENIED (geometría) + incidente ────────────────────────────────
  describe('POST /move — 200 DENIED con parada preventiva e incidente', () => {
    it('deniega un destino dentro de Escaleras, para en SAFE_STOP y no mueve el robot', async () => {
      const res = await move({ destination: { x: 100, y: 300 } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        decision: 'DENIED',
        code: 'RESTRICTED_ZONE_VIOLATION',
        collisionType: 'RESTRICTED_ZONE_VIOLATION',
        state: 'SAFE_STOP',
        position: { x: 120, y: 90 },
        reason: expect.any(String),
      });
      expect(typeof res.body.incidentId).toBe('number');
      expect(res.body.incidentId).toBeGreaterThan(0);
      // R3.3: la posición no cambia y el estado queda en parada.
      expect((await state()).body).toEqual({
        state: 'SAFE_STOP',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
      });
    });

    it('registra el incidente en GET /api/incidents con snapshot de zonas y causa', async () => {
      const denied = await move({ destination: { x: 100, y: 300 } });
      const list = await incidents();
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body)).toBe(true);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        id: denied.body.incidentId,
        decisionCode: 'RESTRICTED_ZONE_VIOLATION',
        collisionType: 'RESTRICTED_ZONE_VIOLATION',
        stateAfter: 'SAFE_STOP',
        origin: { x: 120, y: 90 },
        destination: { x: 100, y: 300 },
        reason: expect.any(String),
        createdAt: expect.any(String),
      });
      // El resumen no trae el snapshot; el detalle (R5.7) incluye las zonas activas usadas.
      expect(list.body[0]).not.toHaveProperty('zonesSnapshot');
      const detail = await request(app).get(`/api/incidents/${denied.body.incidentId}`);
      expect(detail.status).toBe(200);
      expect(Array.isArray(detail.body.zonesSnapshot)).toBe(true);
      expect(detail.body.zonesSnapshot).toContainEqual(
        expect.objectContaining({ name: 'Escaleras', active: true }),
      );
    });
  });

  // ── Move: 409 REJECTED (estado) ─────────────────────────────────────────────
  describe('POST /move — 409 REJECTED por estado (SAFE_STOP activo)', () => {
    it('rechaza un nuevo move estando en SAFE_STOP sin crear incidente (R3.3, R5.3)', async () => {
      await move({ destination: { x: 100, y: 300 } }); // deja el robot en SAFE_STOP
      const before = (await incidents()).body as unknown[];

      const res = await move({ destination: { x: 450, y: 120 } });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        decision: 'REJECTED',
        code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        position: { x: 120, y: 90 },
        reason: expect.any(String),
      });
      // El estado y la posición no cambian por el rechazo.
      expect((await state()).body).toEqual({
        state: 'SAFE_STOP',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
      });
      // R5.3: el rechazo por estado NO crea incidente (se audita aparte en audit_log).
      const after = (await incidents()).body as unknown[];
      expect(after).toHaveLength(before.length);
    });
  });

  // ── Move: 422 payload inválido ──────────────────────────────────────────────
  describe('POST /move — 422 payload inválido', () => {
    it.each([[{}], [{ destination: { x: '1', y: 2 } }], [{ destination: { x: 1 } }]])(
      'rechaza con INVALID_DESTINATION el payload %j (validate/Zod)',
      async (body) => {
        const res = await move(body);
        expect(res.status).toBe(422);
        expect(res.body).toEqual({
          code: 'INVALID_DESTINATION',
          message: expect.any(String),
        });
      },
    );

    it('rechaza con DESTINATION_OUT_OF_BOUNDS un destino fuera del plano (lo lanza el servicio)', async () => {
      const res = await move({ destination: { x: 1000.5, y: 10 } });
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        code: 'DESTINATION_OUT_OF_BOUNDS',
        message: expect.any(String),
      });
      // El robot no cambia tras un payload fuera de límites.
      expect((await state()).body).toEqual({
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
      });
    });

    it('JSON mal formado → 400 sin exponer stack trace', async () => {
      const res = await request(app)
        .post('/api/robot/move')
        .set('Content-Type', 'application/json')
        .send('{bad');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(js|ts)/);
    });
  });

  // ── Recover ─────────────────────────────────────────────────────────────────
  describe('POST /recover', () => {
    it('recupera desde SAFE_STOP con posición segura y calidad RELIABLE → 200 IDLE y desbloquea', async () => {
      // Lleva el robot a SAFE_STOP con una denegación; la posición (120, 90) queda segura.
      await move({ destination: { x: 100, y: 300 } });
      expect((await state()).body.state).toBe('SAFE_STOP');

      const res = await recover();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        robotId: 1,
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
        transitioned: true,
      });
      expect((await state()).body).toEqual({
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
      });
      // Recuperado: un move a destino libre vuelve a autorizarse.
      const after = await move({ destination: { x: 450, y: 120 } });
      expect(after.status).toBe(200);
      expect(after.body.decision).toBe('AUTHORIZED');
    });

    it('en IDLE la recuperación es idempotente → 200 transitioned:false y sin efectos (R4.5)', async () => {
      const res = await recover();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        robotId: 1,
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
        transitioned: false,
      });
      // Sin efectos: el estado permanece IDLE en la misma posición.
      expect((await state()).body).toEqual({
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
      });
    });
  });

  describe('POST /recover — 409 RECOVERY_NOT_ALLOWED (R4.4, Property 16)', () => {
    it('posición insegura: 409 { code, cause, message }, estado sin cambios y fila de auditoría', async () => {
      db.prepare(
        "UPDATE robot_state SET state = 'SAFE_STOP', pos_x = 100, pos_y = 300 WHERE robot_id = 1",
      ).run();

      const res = await recover();

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        code: 'RECOVERY_NOT_ALLOWED',
        cause: 'UNSAFE_POSITION',
        message: expect.any(String),
      });
      expect((await state()).body).toEqual({
        state: 'SAFE_STOP',
        position: { x: 100, y: 300 },
        positionQuality: 'RELIABLE',
      });
      // La fila se lee DESPUÉS de la respuesta 409: el rechazo quedó confirmado.
      expect(db.prepare('SELECT robot_id, event_code, state FROM audit_log').all()).toEqual([
        { robot_id: 1, event_code: 'RECOVERY_NOT_ALLOWED', state: 'SAFE_STOP' },
      ]);
    });

    it('calidad no confiable: cause UNRELIABLE_DATA', async () => {
      db.prepare(
        "UPDATE robot_state SET state = 'DEGRADED', position_quality = 'UNRELIABLE' WHERE robot_id = 1",
      ).run();
      const res = await recover();
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'RECOVERY_NOT_ALLOWED', cause: 'UNRELIABLE_DATA' });
    });
  });

  // ── Incidentes append-only ───────────────────────────────────────────────────
  describe('GET /api/incidents — append-only (R5.1, R5.4)', () => {
    it('lista vacía al inicio', async () => {
      const res = await incidents();
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('cada denegación que para añade un incidente; se listan del más reciente al más antiguo', async () => {
      // Primera denegación (Escaleras).
      const d1 = await move({ destination: { x: 100, y: 300 } });
      await recover(); // libera la parada para poder volver a evaluar geometría
      // Segunda denegación (Cuarto del bebé: AABB [206..393]×[226..404]).
      const d2 = await move({ destination: { x: 300, y: 300 } });

      const list = await incidents();
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
      // Más reciente primero y los ids son crecientes en el tiempo (RC-14, R5.6).
      expect(list.body.map((i: { id: number }) => i.id)).toEqual([
        d2.body.incidentId,
        d1.body.incidentId,
      ]);
      expect(d2.body.incidentId).toBeGreaterThan(d1.body.incidentId);
      expect(list.body[0]).toMatchObject({
        destination: { x: 300, y: 300 },
        robotId: 1,
        rule: 'R-ZONA-01',
        zoneName: 'Cuarto del bebé',
      });
      expect(list.body[1]).toMatchObject({
        destination: { x: 100, y: 300 },
        robotId: 1,
        rule: 'R-ZONA-01',
        zoneName: 'Escaleras',
      });
    });
  });
});
