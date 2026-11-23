import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { AppError } from '../../src/errors/AppError.js';
import {
  createZoneChangeLogRepository,
  type ZoneChangeLogRepository,
} from '../../src/repositories/zoneChangeLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createZoneService, type ZoneService } from '../../src/services/zoneService.js';
import { createTestDb, stairs } from '../helpers.js';

// Spec 001 — RC-8 (RF-05.1–RF-05.4, CA-02.9, CA-02.10, Property 7)
describe('zoneService — registro de cambios', () => {
  let db: Db;
  let service: ZoneService;
  let changes: ZoneChangeLogRepository;
  beforeEach(() => {
    db = createTestDb();
    changes = createZoneChangeLogRepository(db);
    service = createZoneService({
      zones: createZoneRepository(db),
      changes,
      runInTransaction: (fn) => db.transaction(fn).immediate(),
    });
  });

  it('CA-02.9: create/deactivate/activate/update/remove dejan 5 filas en orden', () => {
    const z = service.create(stairs); // CREATE
    service.update(z.id, { active: false }); // DEACTIVATE
    service.update(z.id, { active: true }); // ACTIVATE
    service.update(z.id, { width: 50 }); // UPDATE
    service.remove(z.id); // DELETE

    const log = changes.listAll();
    expect(log.map((c) => c.action)).toEqual([
      'DELETE',
      'UPDATE',
      'ACTIVATE',
      'DEACTIVATE',
      'CREATE',
    ]);
  });

  it('before/after correctos en cada acción', () => {
    const z = service.create(stairs);
    service.update(z.id, { active: false });
    service.remove(z.id);
    const log = changes.listAll();
    expect(log).toHaveLength(3);
    const [del, deact, create] = log as [(typeof log)[0], (typeof log)[0], (typeof log)[0]];

    expect(create.action).toBe('CREATE');
    expect(create.before).toBeNull();
    expect(create.after).toMatchObject({ name: 'Escaleras', active: true });

    expect(deact.action).toBe('DEACTIVATE');
    expect(deact.before).toMatchObject({ active: true });
    expect(deact.after).toMatchObject({ active: false });

    expect(del.action).toBe('DELETE');
    expect(del.before).toMatchObject({ active: false });
    expect(del.after).toBeNull();
  });

  it('CA-02.10: un 404/409/422 no añade filas', () => {
    service.create(stairs);
    expect(() => service.create(stairs)).toThrow(AppError); // 409 duplicado
    expect(() => service.create({ ...stairs, name: 'X', width: 0 })).toThrow(AppError); // 422
    expect(() => service.update(999, { x: 1 })).toThrow(AppError); // 404
    expect(() => service.remove(999)).toThrow(AppError); // 404
    expect(changes.listAll()).toHaveLength(1); // solo el CREATE inicial
  });

  it('un PUT sin cambios no añade fila (RF-05.3)', () => {
    const z = service.create(stairs);
    service.update(z.id, { name: 'Escaleras' }); // mismo valor → no-op
    expect(changes.listAll()).toHaveLength(1);
  });

  it('Property 7: atomicidad — si append falla, la zona no cambia', () => {
    const z = service.create(stairs);
    const failing = createZoneService({
      zones: createZoneRepository(db),
      changes: {
        append: () => {
          throw new Error('append boom');
        },
        listAll: () => changes.listAll(),
      },
      runInTransaction: (fn) => db.transaction(fn).immediate(),
    });
    expect(() => failing.update(z.id, { width: 50 })).toThrow('append boom');
    // La zona conserva su ancho original: la transacción se revirtió.
    expect(service.get(z.id).width).toBe(stairs.width);
  });
});
