import { describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { createRobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';

// Spec 003 — RC-3a (RF-07.3, RF-07.5, DD-110): migración 007 y catálogo de robots

function freshDb() {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

describe('007_create_robots.sql', () => {
  it('registra la versión 007 y crea la tabla robots', () => {
    const db = freshDb();
    expect(
      db
        .prepare('SELECT version FROM schema_migrations WHERE version = ?')
        .get('007_create_robots.sql'),
    ).toBeDefined();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'robots'").get(),
    ).toBeDefined();
  });

  it('siembra A1 (id 1, VACUUM) y V2 (id 2, GUARD)', () => {
    const rows = freshDb().prepare('SELECT id, name, type FROM robots ORDER BY id').all();
    expect(rows).toEqual([
      { id: 1, name: 'Aspiradora A1', type: 'VACUUM' },
      { id: 2, name: 'Vigilante V2', type: 'GUARD' },
    ]);
  });

  it('created_at se rellena en ISO-8601 UTC', () => {
    const row = freshDb().prepare('SELECT created_at FROM robots WHERE id = 1').get() as {
      created_at: string;
    };
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('CHECK de nombre: 1–60 caracteres tras trim', () => {
    const db = freshDb();
    const insert = db.prepare('INSERT INTO robots (name, type) VALUES (?, ?)');
    expect(() => insert.run('', 'VACUUM')).toThrow();
    expect(() => insert.run('    ', 'VACUUM')).toThrow();
    expect(() => insert.run('a'.repeat(61), 'VACUUM')).toThrow();
    expect(() => insert.run('a', 'VACUUM')).not.toThrow();
    expect(() => insert.run('b'.repeat(60), 'GUARD')).not.toThrow();
  });

  it('CHECK de tipo: solo VACUUM o GUARD', () => {
    const db = freshDb();
    expect(() =>
      db.prepare('INSERT INTO robots (name, type) VALUES (?, ?)').run('X', 'DRONE'),
    ).toThrow(/CHECK/);
  });

  it('UNIQUE(name)', () => {
    const db = freshDb();
    expect(() =>
      db.prepare('INSERT INTO robots (name, type) VALUES (?, ?)').run('Aspiradora A1', 'GUARD'),
    ).toThrow(/UNIQUE/);
  });
});

describe('robotCatalogRepository', () => {
  it('list devuelve el catálogo ordenado por id', () => {
    const repo = createRobotCatalogRepository(freshDb());
    expect(repo.list().map((r) => [r.id, r.name, r.type])).toEqual([
      [1, 'Aspiradora A1', 'VACUUM'],
      [2, 'Vigilante V2', 'GUARD'],
    ]);
  });

  it('findById devuelve el robot con createdAt ISO o null si no existe', () => {
    const repo = createRobotCatalogRepository(freshDb());
    const robot = repo.findById(2);
    expect(robot).toMatchObject({ id: 2, name: 'Vigilante V2', type: 'GUARD' });
    expect(robot?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(repo.findById(99)).toBeNull();
  });

  it('create inserta y devuelve el robot nuevo con id siguiente', () => {
    const repo = createRobotCatalogRepository(freshDb());
    const created = repo.create({ name: 'Robot nuevo', type: 'VACUUM' });
    expect(created).toMatchObject({ id: 3, name: 'Robot nuevo', type: 'VACUUM' });
    expect(repo.findById(3)).toEqual(created);
    expect(repo.list()).toHaveLength(3);
  });

  it('create con nombre duplicado lanza y no inserta', () => {
    const repo = createRobotCatalogRepository(freshDb());
    expect(() => repo.create({ name: 'Vigilante V2', type: 'GUARD' })).toThrow(/UNIQUE/);
    expect(repo.list()).toHaveLength(2);
  });

  it('usa parámetros: un nombre con comillas no rompe la sentencia', () => {
    const repo = createRobotCatalogRepository(freshDb());
    const created = repo.create({ name: "x'); DROP TABLE robots;--", type: 'GUARD' });
    expect(repo.findById(created.id)?.name).toBe("x'); DROP TABLE robots;--");
    expect(repo.list()).toHaveLength(3);
  });

  it('findByName devuelve el robot con ese nombre exacto o null', () => {
    const repo = createRobotCatalogRepository(freshDb());
    expect(repo.findByName('Vigilante V2')).toMatchObject({ id: 2, type: 'GUARD' });
    expect(repo.findByName('vigilante v2')).toBeNull();
    expect(repo.findByName("x' OR '1'='1")).toBeNull();
  });
});
