import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { DEFAULT_ROOMS, initDatabase, seedDefaultRooms } from '../../src/db/seed.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';

describe('siembra de habitaciones del prototipo', () => {
  it('define exactamente las 5 habitaciones del prototipo', () => {
    expect(DEFAULT_ROOMS).toEqual([
      { name: 'Sala', x: 29, y: 30, width: 250, height: 178, active: false },
      { name: 'Cocina', x: 296, y: 30, width: 270, height: 178, active: false },
      { name: 'Escaleras', x: 29, y: 226, width: 160, height: 178, active: true },
      { name: 'Cuarto del bebé', x: 206, y: 226, width: 187, height: 178, active: true },
      { name: 'Pasillo', x: 410, y: 226, width: 156, height: 178, active: false },
    ]);
  });

  it('una base nueva arranca con las 5 habitaciones; solo 2 restringidas', () => {
    const db = createDatabase(':memory:');
    initDatabase(db);
    const repo = createZoneRepository(db);
    expect(repo.findAll('all').map((z) => z.name)).toEqual([
      'Sala',
      'Cocina',
      'Escaleras',
      'Cuarto del bebé',
      'Pasillo',
    ]);
    expect(repo.findAll('active').map((z) => z.name)).toEqual(['Escaleras', 'Cuarto del bebé']);
  });

  it('no vuelve a sembrar en arranques posteriores (respeta cambios del operador)', () => {
    const db = createDatabase(':memory:');
    initDatabase(db);
    const repo = createZoneRepository(db);
    repo.delete(1);
    initDatabase(db);
    expect(repo.findAll('all')).toHaveLength(4);
  });

  it('seedDefaultRooms es atómico', () => {
    const db = createDatabase(':memory:');
    migrate(db);
    db.prepare(
      "INSERT INTO zones (name, x, y, width, height) VALUES ('Pasillo', 0, 0, 1, 1)",
    ).run();
    expect(() => seedDefaultRooms(db)).toThrow();
    expect(createZoneRepository(db).findAll('all')).toHaveLength(1);
  });
});
