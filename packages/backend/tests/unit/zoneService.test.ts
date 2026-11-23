import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/AppError.js';
import { type ZoneService } from '../../src/services/zoneService.js';
import { createTestDb, createTestZoneService, stairs } from '../helpers.js';

function expectAppError(fn: () => unknown, status: number, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status, code });
    return;
  }
  throw new Error(`Se esperaba ${code}`);
}

describe('zoneService', () => {
  let service: ZoneService;
  beforeEach(() => {
    service = createTestZoneService(createTestDb());
  });

  it('CA-02.1 crea una zona válida', () => {
    expect(service.create(stairs)).toMatchObject({ id: 1, ...stairs });
  });

  describe('CA-02.3 dimensiones → 422 INVALID_ZONE_DIMENSIONS', () => {
    it.each([
      [0, 10],
      [10, 0],
      [-5, 10],
      [10, -5],
    ])('width=%d height=%d al crear', (width, height) => {
      expectAppError(
        () => service.create({ ...stairs, width, height }),
        422,
        'INVALID_ZONE_DIMENSIONS',
      );
    });

    it('al modificar', () => {
      const z = service.create(stairs);
      expectAppError(() => service.update(z.id, { width: 0 }), 422, 'INVALID_ZONE_DIMENSIONS');
    });
  });

  describe('CA-02.4 fuera del plano → 422 ZONE_OUT_OF_BOUNDS', () => {
    it.each([{ x: -1 }, { y: -1 }, { x: 801, width: 200 }, { y: 651, height: 150 }])(
      '%o al crear',
      (patch) => {
        expectAppError(() => service.create({ ...stairs, ...patch }), 422, 'ZONE_OUT_OF_BOUNDS');
      },
    );

    it('acepta una zona que toca exactamente el borde del plano', () => {
      expect(service.create({ ...stairs, x: 0, y: 0, width: 1000, height: 800 })).toBeDefined();
    });

    it('al modificar', () => {
      const z = service.create(stairs);
      expectAppError(() => service.update(z.id, { x: 900 }), 422, 'ZONE_OUT_OF_BOUNDS');
    });
  });

  describe('CA-02.2 nombre duplicado → 409 ZONE_NAME_DUPLICATE', () => {
    it('al crear', () => {
      service.create(stairs);
      expectAppError(() => service.create(stairs), 409, 'ZONE_NAME_DUPLICATE');
    });

    it('al modificar con el nombre de otra zona', () => {
      service.create(stairs);
      const other = service.create({ ...stairs, name: 'Cuna' });
      expectAppError(
        () => service.update(other.id, { name: 'Escaleras' }),
        409,
        'ZONE_NAME_DUPLICATE',
      );
    });

    it('permite modificar conservando su propio nombre', () => {
      const z = service.create(stairs);
      expect(service.update(z.id, { name: 'Escaleras', x: 10 }).x).toBe(10);
    });
  });

  it('CA-02.5 modifica y persiste los nuevos valores', () => {
    const z = service.create(stairs);
    service.update(z.id, { name: 'Escalera norte', width: 50 });
    expect(service.get(z.id)).toMatchObject({ name: 'Escalera norte', width: 50, height: 150 });
  });

  describe('CA-02.6 / CA-02.8 filtro active', () => {
    beforeEach(() => {
      service.create(stairs);
      const cuna = service.create({ ...stairs, name: 'Cuna' });
      service.update(cuna.id, { active: false });
    });

    it('por defecto solo activas', () => {
      expect(service.list().map((z) => z.name)).toEqual(['Escaleras']);
    });
    it('all devuelve activas e inactivas', () => {
      expect(service.list('all').map((z) => z.name)).toEqual(['Escaleras', 'Cuna']);
    });
    it('false devuelve solo inactivas', () => {
      expect(service.list('false').map((z) => z.name)).toEqual(['Cuna']);
    });
  });

  it('ZONE_NOT_FOUND en get/update/remove', () => {
    expectAppError(() => service.get(9), 404, 'ZONE_NOT_FOUND');
    expectAppError(() => service.update(9, { x: 1 }), 404, 'ZONE_NOT_FOUND');
    expectAppError(() => service.remove(9), 404, 'ZONE_NOT_FOUND');
  });
});
