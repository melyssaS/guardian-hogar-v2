import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { createTestDb, stairs } from '../helpers.js';

describe('API /api/zones', () => {
  let app: Express;
  beforeEach(() => {
    app = createApp(createTestDb(), { corsOrigins: ['http://localhost:5173'] });
  });

  const create = (body: object) => request(app).post('/api/zones').send(body);

  describe('POST', () => {
    it('201 crea y persiste (CA-02.1)', async () => {
      const res = await create(stairs);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 1, ...stairs });
      expect(typeof res.body.createdAt).toBe('string');
      const get = await request(app).get('/api/zones/1');
      expect(get.body).toEqual(res.body);
    });

    it('409 ZONE_NAME_DUPLICATE (CA-02.2)', async () => {
      await create(stairs);
      const res = await create(stairs);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ code: 'ZONE_NAME_DUPLICATE', message: expect.any(String) });
    });

    it('422 INVALID_ZONE_DIMENSIONS (CA-02.3)', async () => {
      const res = await create({ ...stairs, width: 0 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_ZONE_DIMENSIONS');
    });

    it('422 ZONE_OUT_OF_BOUNDS (CA-02.4)', async () => {
      const res = await create({ ...stairs, x: 900 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('ZONE_OUT_OF_BOUNDS');
    });

    it('422 VALIDATION_ERROR con cuerpo mal tipado', async () => {
      const res = await create({ name: '', x: 'a' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('400 INVALID_JSON sin stack trace', async () => {
      const res = await request(app)
        .post('/api/zones')
        .set('Content-Type', 'application/json')
        .send('{bad');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ code: 'INVALID_JSON', message: 'Malformed JSON body' });
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(js|ts)/);
    });
  });

  describe('GET lista + filtro active', () => {
    beforeEach(async () => {
      await create(stairs);
      await create({ ...stairs, name: 'Cuna', active: false });
    });

    it('por defecto solo activas (RF-02.5)', async () => {
      const res = await request(app).get('/api/zones');
      expect(res.status).toBe(200);
      expect(res.body.map((z: { name: string }) => z.name)).toEqual(['Escaleras']);
    });

    it('?active=all devuelve todas (CA-02.8)', async () => {
      const res = await request(app).get('/api/zones?active=all');
      expect(res.body).toHaveLength(2);
    });

    it('?active=false devuelve inactivas', async () => {
      const res = await request(app).get('/api/zones?active=false');
      expect(res.body.map((z: { name: string }) => z.name)).toEqual(['Cuna']);
    });

    it('422 con un valor de filtro no soportado', async () => {
      const res = await request(app).get('/api/zones?active=yes');
      expect(res.status).toBe(422);
    });
  });

  describe('GET /:id', () => {
    it('200 existente', async () => {
      await create(stairs);
      expect((await request(app).get('/api/zones/1')).status).toBe(200);
    });
    it('404 ZONE_NOT_FOUND', async () => {
      const res = await request(app).get('/api/zones/42');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ZONE_NOT_FOUND');
    });
    it('422 con id no numérico', async () => {
      expect((await request(app).get('/api/zones/abc')).status).toBe(422);
    });
  });

  describe('PUT /:id', () => {
    beforeEach(async () => {
      await create(stairs);
    });

    it('200 con los nuevos valores persistidos (CA-02.5)', async () => {
      const res = await request(app).put('/api/zones/1').send({ name: 'Escalera', width: 50 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Escalera', width: 50, height: 150, active: true });
      expect((await request(app).get('/api/zones/1')).body.name).toBe('Escalera');
    });

    it('desactivar la quita del listado por defecto pero sigue existiendo (CA-02.6)', async () => {
      await request(app).put('/api/zones/1').send({ active: false });
      expect((await request(app).get('/api/zones')).body).toEqual([]);
      const one = await request(app).get('/api/zones/1');
      expect(one.status).toBe(200);
      expect(one.body.active).toBe(false);
    });

    it('un PUT parcial no reactiva una zona inactiva', async () => {
      await request(app).put('/api/zones/1').send({ active: false });
      const res = await request(app).put('/api/zones/1').send({ name: 'Escalera' });
      expect(res.body.active).toBe(false);
    });

    it('404 ZONE_NOT_FOUND', async () => {
      const res = await request(app).put('/api/zones/99').send({ x: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ZONE_NOT_FOUND');
    });

    it('409 ZONE_NAME_DUPLICATE', async () => {
      await create({ ...stairs, name: 'Cuna' });
      const res = await request(app).put('/api/zones/2').send({ name: 'Escaleras' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ZONE_NAME_DUPLICATE');
    });

    it('422 INVALID_ZONE_DIMENSIONS y ZONE_OUT_OF_BOUNDS', async () => {
      const dims = await request(app).put('/api/zones/1').send({ height: -1 });
      expect(dims.status).toBe(422);
      expect(dims.body.code).toBe('INVALID_ZONE_DIMENSIONS');
      const oob = await request(app).put('/api/zones/1').send({ y: 700 });
      expect(oob.status).toBe(422);
      expect(oob.body.code).toBe('ZONE_OUT_OF_BOUNDS');
    });
  });

  describe('DELETE /:id', () => {
    it('204 y ya no aparece en ningún listado (CA-02.7)', async () => {
      await create(stairs);
      const res = await request(app).delete('/api/zones/1');
      expect(res.status).toBe(204);
      expect((await request(app).get('/api/zones?active=all')).body).toEqual([]);
      expect((await request(app).get('/api/zones/1')).status).toBe(404);
    });

    it('404 ZONE_NOT_FOUND', async () => {
      const res = await request(app).delete('/api/zones/1');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ZONE_NOT_FOUND');
    });
  });

  describe('seguridad', () => {
    it('helmet añade cabeceras y oculta x-powered-by', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('rate limit responde 429 al superar el límite', async () => {
      const limited = createApp(createTestDb(), { corsOrigins: [], rateLimitPerMinute: 2 });
      await request(limited).get('/api/zones');
      await request(limited).get('/api/zones');
      const res = await request(limited).get('/api/zones');
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('TOO_MANY_REQUESTS');
    });

    it('500 genérico sin stack trace ante errores no controlados', async () => {
      const db = createTestDb();
      const broken = createApp(db, { corsOrigins: [] });
      db.exec('DROP TABLE zones');
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await request(broken).get('/api/zones');
      expect(log).toHaveBeenCalled();
      log.mockRestore();
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
    });
  });
});
