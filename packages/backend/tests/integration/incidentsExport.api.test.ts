import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createTestDb } from '../helpers.js';

// Spec 007 — T6: GET /api/incidents/export sobre la app REAL (`createApp`), para cubrir también
// CORS y el montaje (CA-07.1, 07.2, 07.4, 07.5, 07.6, 07.7, 07.8).

const ORIGIN = 'http://localhost:5173';
const HEADER_LINE =
  'id,robotId,robotName,rule,zoneName,decisionCode,collisionType,stateAfter,originX,originY,destX,destY,reason,createdAt';

/** Recibe el cuerpo como bytes crudos para comprobar el BOM y la decodificación UTF-8. */
function binary(res: request.Response, done: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

const decode = (bytes: Buffer) =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

/** Ids de las filas de datos de un CSV decodificado (primera columna). */
const csvIds = (text: string) =>
  text
    .slice(1)
    .split('\r\n')
    .slice(1)
    .map((line) => Number(line.split(',')[0]));

describe('GET /api/incidents/export (spec 007)', () => {
  let db: Db;
  let app: Express;

  beforeEach(() => {
    db = createTestDb();
    app = createApp(db, { corsOrigins: [ORIGIN] });
  });

  function seed(robotId: number, zoneName: string, reason: string) {
    return createIncidentRepository(db).create({
      robotId,
      rule: 'R-ZONA-01',
      zoneName,
      decisionCode: 'TRAJECTORY_CROSSES_ZONE',
      collisionType: 'TRAJECTORY_CROSSES_ZONE',
      stateAfter: 'SAFE_STOP',
      origin: { x: 120, y: 90 },
      destination: { x: 110, y: 400 },
      zonesSnapshot: [],
      reason,
    });
  }

  const count = (table: 'incidents' | 'audit_log') =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  const exportCsv = (query = '') =>
    request(app)
      .get(`/api/incidents/export${query}`)
      .set('Origin', ORIGIN)
      .buffer(true)
      .parse(binary);

  it('CA-07.1 200, text/csv UTF-8, BOM, encabezados y filas en el orden de GET /api/incidents', async () => {
    seed(1, 'Escaleras', 'primero');
    seed(2, 'Escaleras', 'segundo');
    seed(1, 'Escaleras', 'tercero');
    const res = await exportCsv();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    const text = decode(res.body as Buffer);
    expect(text.slice(1).split('\r\n')[0]).toBe(HEADER_LINE);
    const list = await request(app).get('/api/incidents');
    expect(csvIds(text)).toEqual(list.body.map((i: { id: number }) => i.id));
    expect(csvIds(text)).toEqual([3, 2, 1]);
  });

  it('CA-07.2 ?robotId=1 devuelve los mismos ids que GET /api/incidents?robotId=1, sin el robot 2', async () => {
    seed(1, 'Escaleras', 'a');
    seed(2, 'Escaleras', 'b');
    seed(1, 'Escaleras', 'c');
    const res = await exportCsv('?robotId=1');
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/incidents?robotId=1');
    const ids = csvIds(decode(res.body as Buffer));
    expect(ids).toEqual(list.body.map((i: { id: number }) => i.id));
    expect(ids).toEqual([3, 1]);
  });

  it('CA-07.2 robot inexistente → 404 ROBOT_NOT_FOUND en JSON', async () => {
    const res = await request(app).get('/api/incidents/export?robotId=999');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ code: 'ROBOT_NOT_FOUND', message: 'Robot 999 not found' });
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it.each(['abc', '0', '-1'])(
    'CA-07.7 robotId=%s → 422 VALIDATION_ERROR sin stack',
    async (value) => {
      const res = await request(app).get(`/api/incidents/export?robotId=${value}`);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body).sort()).toEqual(['code', 'message']);
      expect(JSON.stringify(res.body)).not.toMatch(/at .+\.(ts|js)/);
    },
  );

  it('CA-07.6 sin incidentes → BOM + solo encabezados', async () => {
    const res = await exportCsv();
    expect(res.status).toBe(200);
    expect(decode(res.body as Buffer)).toBe(`\uFEFF${HEADER_LINE}`);
  });

  it('CA-07.5 Content-Disposition attachment con nombre fechado y expuesto por CORS', async () => {
    const res = await exportCsv();
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="incidentes-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-expose-headers']).toMatch(/Content-Disposition/i);
  });

  it('CA-07.4 los bytes empiezan por EF BB BF y "Cuarto del bebé" se decodifica bien', async () => {
    seed(1, 'Cuarto del bebé', 'entró al cuarto');
    const res = await exportCsv();
    const bytes = res.body as Buffer;
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = decode(bytes);
    expect(text).toContain('Cuarto del bebé');
    expect(text).toContain('entró al cuarto');
  });

  it('CA-07.8 exportar no cambia el número de filas de incidents ni de audit_log', async () => {
    seed(1, 'Escaleras', 'a');
    const before = { incidents: count('incidents'), audit: count('audit_log') };
    await exportCsv();
    await exportCsv('?robotId=1');
    await request(app).get('/api/incidents/export?robotId=999');
    expect({ incidents: count('incidents'), audit: count('audit_log') }).toEqual(before);
  });

  it('/:id sigue funcionando y no captura /export', async () => {
    const created = seed(1, 'Escaleras', 'a');
    const res = await request(app).get(`/api/incidents/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.id);
  });
});
