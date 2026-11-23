import type { Zone } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { createZoneChangeLogRepository } from '../../src/repositories/zoneChangeLogRepository.js';
import { createTestDb } from '../helpers.js';

// Spec 001 — RC-7 (RF-05.1, RF-05.6)
const zone: Zone = {
  id: 5,
  name: 'Pasillo',
  x: 410,
  y: 226,
  width: 156,
  height: 178,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

describe('zoneChangeLogRepository', () => {
  let db: Db;
  let repo: ReturnType<typeof createZoneChangeLogRepository>;
  beforeEach(() => {
    db = createTestDb();
    repo = createZoneChangeLogRepository(db);
  });

  it('append CREATE guarda before null y after como Zone', () => {
    repo.append({ zoneId: zone.id, action: 'CREATE', before: null, after: zone });
    const row = repo.listAll()[0];
    expect(row).toMatchObject({ zoneId: 5, action: 'CREATE', before: null, after: zone });
    expect(typeof row?.id).toBe('number');
    expect(typeof row?.createdAt).toBe('string');
  });

  it('append DELETE guarda after null', () => {
    repo.append({ zoneId: zone.id, action: 'DELETE', before: zone, after: null });
    const row = repo.listAll()[0];
    expect(row).toMatchObject({ action: 'DELETE', before: zone, after: null });
  });

  it('listAll ordena del más reciente al más antiguo (id DESC)', () => {
    repo.append({ zoneId: 5, action: 'CREATE', before: null, after: zone });
    repo.append({
      zoneId: 5,
      action: 'DEACTIVATE',
      before: zone,
      after: { ...zone, active: false },
    });
    repo.append({ zoneId: 5, action: 'DELETE', before: { ...zone, active: false }, after: null });
    expect(repo.listAll().map((r) => r.action)).toEqual(['DELETE', 'DEACTIVATE', 'CREATE']);
  });

  it('redondea el JSON a la Zone original (mapeo JSON ↔ Zone)', () => {
    const after: Zone = { ...zone, width: 200 };
    repo.append({ zoneId: 5, action: 'UPDATE', before: zone, after });
    const row = repo.listAll()[0];
    expect(row?.before).toEqual(zone);
    expect(row?.after).toEqual(after);
  });
});
