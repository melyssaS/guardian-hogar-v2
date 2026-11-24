import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/AppError.js';
import { errorHandler } from '../../src/middlewares/errorHandler.js';

// Spec 002 — RC-11 (R4.4, R12.2): `AppError` admite un `cause` opcional que el manejador de
// errores expone en el cuerpo `{ code, message, cause? }`, sin stack trace (R7.2).
function appThrowing(error: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler con cause opcional', () => {
  it('incluye cause cuando el AppError lo trae', async () => {
    const res = await request(
      appThrowing(
        new AppError(
          409,
          'ROBOT_START_NOT_VERIFIABLE',
          'Zones unavailable',
          'ZONE_DATA_UNAVAILABLE',
        ),
      ),
    ).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: 'ROBOT_START_NOT_VERIFIABLE',
      message: 'Zones unavailable',
      cause: 'ZONE_DATA_UNAVAILABLE',
    });
  });

  it('omite cause cuando no existe (contrato anterior intacto)', async () => {
    const res = await request(appThrowing(new AppError(404, 'ROBOT_NOT_FOUND', 'Robot 9'))).get(
      '/boom',
    );
    expect(res.body).toEqual({ code: 'ROBOT_NOT_FOUND', message: 'Robot 9' });
  });

  it('un error desconocido responde 500 sin stack trace', async () => {
    const res = await request(appThrowing(new Error('secret'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  });
});
