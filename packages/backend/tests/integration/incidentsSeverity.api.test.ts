import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import {
  createIncidentRepository,
  type IncidentInput,
} from '../../src/repositories/incidentRepository.js';
import { createRobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';
import { createIncidentRoutes } from '../../src/routes/incidentRoutes.js';
import { createTestDb } from '../helpers.js';

// Spec 006 — HU-06 (CA-06.1, CA-06.3 a CA-06.7, CA-06.9): GET /api/incidents?severity=.
// Fixture A (requirements §5): 5 incidentes, ids ascendentes = orden de creación.
// Fixture B: solo CRITICAL y HIGH.

const base: IncidentInput = {
  robotId: 1,
  rule: 'R-ZONA-01',
  zoneName: null,
  decisionCode: 'RESTRICTED_ZONE_VIOLATION',
  collisionType: null,
  stateAfter: 'SAFE_STOP',
  origin: { x: 10, y: 20 },
  destination: { x: 150, y: 150 },
  zonesSnapshot: [],
  reason: 'x',
};

type Seed = [robotId: number, code: IncidentInput['decisionCode'], reason: string];

const FIXTURE_A: Seed[] = [
  [1, 'ORIGIN_IN_RESTRICTED_ZONE', 'critical-r1'],
  [1, 'RESTRICTED_ZONE_VIOLATION', 'high-r1'],
  [1, 'POSITION_QUALITY_LOST', 'low-r1'],
  [2, 'ZONE_DATA_UNAVAILABLE', 'high-r2'],
  [2, 'TRAJECTORY_CROSSES_ZONE', 'medium-r2'],
];
const FIXTURE_B: Seed[] = [
  [1, 'ORIGIN_IN_RESTRICTED_ZONE', 'critical-r1'],
  [1, 'RESTRICTED_ZONE_VIOLATION', 'high-r1'],
];

const reasons = (body: { reason: string }[]) => body.map((i) => i.reason);

describe('GET /api/incidents?severity= (spec 006)', () => {
  let db: Db;
  let app: Express;

  function load(fixture: Seed[]) {
    const repo = createIncidentRepository(db);
    for (const [robotId, decisionCode, reason] of fixture) {
      repo.create({ ...base, robotId, decisionCode, reason });
    }
  }

  beforeEach(() => {
    db = createTestDb();
    app = express();
    app.use(
      '/api/incidents',
      createIncidentRoutes(createIncidentRepository(db), createRobotCatalogRepository(db)),
    );
    app.use(errorHandler);
  });

  describe('con el fixture A', () => {
    beforeEach(() => load(FIXTURE_A));

    it('CA-06.1 cada severidad devuelve solo su nivel', async () => {
      for (const [severity, expected] of [
        ['CRITICAL', ['critical-r1']],
        ['MEDIUM', ['medium-r2']],
        ['LOW', ['low-r1']],
      ] as const) {
        const res = await request(app).get('/api/incidents').query({ severity });
        expect(res.status).toBe(200);
        expect(reasons(res.body)).toEqual(expected);
        expect(res.body.every((i: { severity: string }) => i.severity === severity)).toBe(true);
      }
    });

    it('CA-06.1 HIGH devuelve los dos incidentes HIGH, el más reciente primero', async () => {
      const res = await request(app).get('/api/incidents').query({ severity: 'HIGH' });
      expect(res.status).toBe(200);
      expect(reasons(res.body)).toEqual(['high-r2', 'high-r1']);
    });

    it('CA-06.9 sin severity devuelve los 5, mismo orden de siempre, cada uno con severity', async () => {
      const res = await request(app).get('/api/incidents');
      expect(res.status).toBe(200);
      expect(reasons(res.body)).toEqual([
        'medium-r2',
        'high-r2',
        'low-r1',
        'high-r1',
        'critical-r1',
      ]);
      expect(res.body.map((i: { severity: string }) => i.severity)).toEqual([
        'MEDIUM',
        'HIGH',
        'LOW',
        'HIGH',
        'CRITICAL',
      ]);
    });

    it('CA-06.5 valores inválidos → 422 INVALID_SEVERITY_FILTER con { code, message }', async () => {
      for (const qs of [
        'severity=high',
        'severity=',
        'severity=URGENT',
        'severity=HIGH&severity=LOW',
        'severity[]=HIGH',
        'severity[a]=1',
      ]) {
        const res = await request(app).get(`/api/incidents?${qs}`);
        expect(res.status, qs).toBe(422);
        expect(res.body, qs).toEqual({
          code: 'INVALID_SEVERITY_FILTER',
          message: expect.any(String),
        });
      }
    });

    it('CA-06.5 un parámetro desconocido se ignora', async () => {
      const res = await request(app).get('/api/incidents?_=123');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(5);
    });

    it('CA-06.7 se combina con robotId', async () => {
      const res = await request(app).get('/api/incidents').query({ robotId: 1, severity: 'HIGH' });
      expect(res.status).toBe(200);
      expect(reasons(res.body)).toEqual(['high-r1']);
    });

    it('CA-06.7 robotId inválido conserva VALIDATION_ERROR, con o sin severity inválida', async () => {
      for (const qs of [
        'robotId=abc',
        'robotId=abc&severity=HIGH',
        'robotId=abc&severity=URGENT',
      ]) {
        const res = await request(app).get(`/api/incidents?${qs}`);
        expect(res.status, qs).toBe(422);
        expect(res.body.code, qs).toBe('VALIDATION_ERROR');
      }
    });

    it('CA-06.7 robotId inexistente con severity → 404 ROBOT_NOT_FOUND', async () => {
      const res = await request(app)
        .get('/api/incidents')
        .query({ robotId: 999, severity: 'HIGH' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ROBOT_NOT_FOUND');
    });

    it('CA-06.6 el detalle GET /:id trae severity', async () => {
      const res = await request(app).get('/api/incidents/1');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 1, severity: 'CRITICAL' });
      const detail = await request(app).get('/api/incidents/4');
      expect(detail.body.severity).toBe('HIGH');
    });
  });

  describe('con el fixture B (sin MEDIUM ni LOW)', () => {
    beforeEach(() => load(FIXTURE_B));

    it('CA-06.4 una severidad sin incidentes → 200 []', async () => {
      for (const severity of ['LOW', 'MEDIUM']) {
        const res = await request(app).get('/api/incidents').query({ severity });
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      }
    });
  });

  // Prueba de CARACTERIZACIÓN (tarea 6): el registro es de solo lectura; pasa antes y después de
  // implementar el filtro. No lleva ROJO porque ya se cumple hoy.
  describe('CA-06.3 no modifica', () => {
    const TABLES = ['incidents', 'audit_log', 'robots', 'robot_state', 'robot_sessions'];
    const dump = () =>
      JSON.stringify(TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));

    beforeEach(() => load(FIXTURE_A));

    it('filtrar y restablecer, con y sin resultados, deja las tablas idénticas', async () => {
      const before = dump();
      await request(app).get('/api/incidents').query({ severity: 'HIGH' });
      await request(app).get('/api/incidents').query({ severity: 'LOW' });
      await request(app).get('/api/incidents').query({ severity: 'CRITICAL', robotId: 2 });
      await request(app).get('/api/incidents?severity=URGENT');
      await request(app).get('/api/incidents');
      expect(dump()).toBe(before);
    });

    it('POST/PUT/PATCH/DELETE sobre /api/incidents no existen (404)', async () => {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(app)[method]('/api/incidents');
        expect(res.status, method).toBe(404);
        const byId = await request(app)[method]('/api/incidents/1');
        expect(byId.status, `${method} /1`).toBe(404);
      }
    });
  });
});
