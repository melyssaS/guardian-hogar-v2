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
