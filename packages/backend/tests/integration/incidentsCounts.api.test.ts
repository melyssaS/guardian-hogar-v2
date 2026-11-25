import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IncidentCounts, RuleId } from '@home-guardian/domain';
import type { Db } from '../../src/db/connection.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';
import {
  createIncidentRepository,
  type IncidentInput,
} from '../../src/repositories/incidentRepository.js';
import { createRobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';
import { createIncidentRoutes } from '../../src/routes/incidentRoutes.js';
import { createTestDb } from '../helpers.js';

// Spec 008 — HU-08: GET /api/incidents/counts (conteo por tipo = regla). La ruta /counts debe
// preceder a /:id (DD-08.5, H-2); el conteo es global, sin filtros (CA-08.2, DD-08.6).

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

/** Siembra un incidente de la regla pedida con un robot válido del seed (A1 = 1, V2 = 2). */
function seed(db: Db, rule: RuleId, robotId = 1) {
  const input: IncidentInput = {
    robotId,
    rule,
    zoneName: rule === 'R-ZONA-01' ? 'Escaleras' : null,
    decisionCode:
      rule === 'R-ZONA-01'
        ? 'TRAJECTORY_CROSSES_ZONE'
        : rule === 'R-SIGNAL-01'
          ? 'MISSING_POSITION'
          : 'ZONE_DATA_UNAVAILABLE',
    collisionType: null,
    stateAfter: 'SAFE_STOP',
    origin: { x: 120, y: 90 },
    destination: { x: 110, y: 400 },
    zonesSnapshot: [STAIRS],
    reason: 'siembra',
  };
  return createIncidentRepository(db).create(input);
}

describe('API /api/incidents/counts (HU-08)', () => {
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

  it('CA-08.1 /counts precede a /:id: devuelve el contrato de conteos, no 422 ni 404', async () => {
    const res = await request(app).get('/api/incidents/counts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('byType');
    expect(res.body.code).toBeUndefined(); // no es un 422 VALIDATION_ERROR ni 404 INCIDENT_NOT_FOUND
  });

  it('CA-08.1 responde 200 con las 3 categorías en orden de catálogo y el total', async () => {
    seed(db, 'R-ZONA-01');
    seed(db, 'R-ZONA-01');
    seed(db, 'R-SIGNAL-01', 2);
    const res = await request(app).get('/api/incidents/counts');
    expect(res.status).toBe(200);
    const body = res.body as IncidentCounts;
    expect(body.byType.map((t) => t.rule)).toEqual(['R-ZONA-01', 'R-SIGNAL-01', 'R-DATA-01']);
    expect(body.byType).toEqual([
      { rule: 'R-ZONA-01', title: 'No circular por zonas restringidas', count: 2 },
      { rule: 'R-SIGNAL-01', title: 'Posición no confiable o ausente', count: 1 },
      { rule: 'R-DATA-01', title: 'Información de zonas no disponible', count: 0 },
    ]);
    expect(body.total).toBe(3);
  });

  it('CA-08.2 total = número de elementos de GET /api/incidents sin filtros', async () => {
    seed(db, 'R-ZONA-01');
    seed(db, 'R-SIGNAL-01', 2);
    seed(db, 'R-DATA-01');
    const list = await request(app).get('/api/incidents');
    const counts = await request(app).get('/api/incidents/counts');
    expect((counts.body as IncidentCounts).total).toBe(list.body.length);
  });

  it('CA-08.3 base sin incidentes → todo en 0', async () => {
    const res = await request(app).get('/api/incidents/counts');
    const body = res.body as IncidentCounts;
    expect(body.total).toBe(0);
    expect(body.byType.every((t) => t.count === 0)).toBe(true);
    expect(body.byType.map((t) => t.rule)).toEqual(['R-ZONA-01', 'R-SIGNAL-01', 'R-DATA-01']);
  });

  it('CA-08.4 consultar /counts no altera la lista de incidentes', async () => {
    seed(db, 'R-ZONA-01');
    seed(db, 'R-SIGNAL-01', 2);
    const before = await request(app).get('/api/incidents');
    await request(app).get('/api/incidents/counts');
    const after = await request(app).get('/api/incidents');
    expect(after.body).toEqual(before.body);
  });
});
