import { beforeEach, describe, expect, it } from 'vitest';
import {
  createZoneRepository,
  DuplicateZoneNameError,
  type ZoneRepository,
} from '../../src/repositories/zoneRepository.js';
import { createTestDb, stairs } from '../helpers.js';

describe('zoneRepository', () => {
  let repo: ZoneRepository;
  beforeEach(() => {
    repo = createZoneRepository(createTestDb());
  });

  it('crea y mapea active 0|1 ↔ boolean y createdAt ISO', () => {
    const z = repo.create({ ...stairs, active: false });
    expect(z).toMatchObject({ id: 1, name: 'Escaleras', active: false });
    expect(new Date(z.createdAt).toISOString()).toBe(z.createdAt);
    expect(repo.findById(1)?.active).toBe(false);
  });

  it('lanza DuplicateZoneNameError con nombre repetido (UNIQUE)', () => {
    repo.create(stairs);
    expect(() => repo.create(stairs)).toThrow(DuplicateZoneNameError);
  });

  it('filtra por active', () => {
    repo.create(stairs);
    repo.create({ ...stairs, name: 'Cuna', active: false });
    expect(repo.findAll('active').map((z) => z.name)).toEqual(['Escaleras']);
    expect(repo.findAll('inactive').map((z) => z.name)).toEqual(['Cuna']);
    expect(repo.findAll('all')).toHaveLength(2);
  });

  it('existsByName excluye el id indicado', () => {
    const z = repo.create(stairs);
    expect(repo.existsByName('Escaleras')).toBe(true);
    expect(repo.existsByName('Escaleras', z.id)).toBe(false);
  });

  it('update y delete devuelven null/false si no existe', () => {
    expect(repo.update(99, stairs)).toBeNull();
    expect(repo.delete(99)).toBe(false);
  });

  it('trata el nombre como dato, no como SQL', () => {
    const name = "x'); DROP TABLE zones; --";
    repo.create({ ...stairs, name });
    expect(repo.existsByName(name)).toBe(true);
    expect(repo.findAll('all')).toHaveLength(1);
  });
});
