import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createTestDb, stairs } from '../helpers.js';

// Spec 001 — RC-10 (RF-05.6, CA-02.9, CA-02.10)
describe('API GET /api/zones/changes', () => {
  let app: Express;
  beforeEach(() => {
    app = createApp(createTestDb(), { corsOrigins: ['http://localhost:5173'] });
  });

  it('CA-02.9: la secuencia devuelve 5 filas en orden (más reciente primero)', async () => {
    const created = await request(app).post('/api/zones').send(stairs);
    const id = created.body.id as number;
    await request(app).put(`/api/zones/${id}`).send({ active: false }); // DEACTIVATE
    await request(app).put(`/api/zones/${id}`).send({ active: true }); // ACTIVATE
    await request(app).put(`/api/zones/${id}`).send({ width: 50 }); // UPDATE
    await request(app).delete(`/api/zones/${id}`); // DELETE

    const res = await request(app).get('/api/zones/changes');
    expect(res.status).toBe(200);
    expect(res.body.map((c: { action: string }) => c.action)).toEqual([
      'DELETE',
      'UPDATE',
      'ACTIVATE',
      'DEACTIVATE',
      'CREATE',
    ]);
    const [del, , , deact, create] = res.body;
    expect(create).toMatchObject({ zoneId: id, before: null, after: { name: 'Escaleras' } });
    expect(deact).toMatchObject({ before: { active: true }, after: { active: false } });
    expect(del).toMatchObject({ before: { active: true, width: 50 }, after: null });
  });

  it('/changes no se interpreta como /:id', async () => {
    const res = await request(app).get('/api/zones/changes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('CA-02.10: un 409/422 no añade filas', async () => {
    await request(app).post('/api/zones').send(stairs);
    await request(app).post('/api/zones').send(stairs); // 409 duplicado
    await request(app)
      .post('/api/zones')
      .send({ ...stairs, name: 'X', width: 0 }); // 422
    const res = await request(app).get('/api/zones/changes');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].action).toBe('CREATE');
  });
});
