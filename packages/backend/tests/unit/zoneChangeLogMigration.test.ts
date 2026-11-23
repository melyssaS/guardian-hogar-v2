import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers.js';

// Spec 001 — RC-5 (RF-05.5, CA-02.11, RNF-06): zone_change_log existe, con sus CHECK y triggers.
describe('013_create_zone_change_log', () => {
  const insert = (
    db: ReturnType<typeof createTestDb>,
    action: string,
    before: string | null,
    after: string | null,
  ) =>
    db
      .prepare(`INSERT INTO zone_change_log (zone_id, action, before, after) VALUES (?, ?, ?, ?)`)
      .run(1, action, before, after);

  it('la tabla zone_change_log existe', () => {
    const db = createTestDb();
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'zone_change_log'")
        .get(),
    ).toBeDefined();
  });

  it('rechaza una acción fuera del catálogo (CHECK)', () => {
    const db = createTestDb();
    expect(() => insert(db, 'ARCHIVE', null, '{}')).toThrow();
  });

  it('CREATE exige before NULL', () => {
    const db = createTestDb();
    expect(() => insert(db, 'CREATE', '{}', '{}')).toThrow();
    expect(() => insert(db, 'CREATE', null, '{}')).not.toThrow();
  });

  it('DELETE exige after NULL', () => {
    const db = createTestDb();
    expect(() => insert(db, 'DELETE', '{}', '{}')).toThrow();
    expect(() => insert(db, 'DELETE', '{}', null)).not.toThrow();
  });

  it('es append-only: rechaza UPDATE y DELETE directos (CA-02.11, RNF-06)', () => {
    const db = createTestDb();
    insert(db, 'CREATE', null, '{"id":1}');
    expect(() => db.prepare("UPDATE zone_change_log SET action = 'UPDATE'").run()).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM zone_change_log').run()).toThrow(/append-only/);
  });

  it('created_at por defecto es un ISO-8601 con milisegundos y Z', () => {
    const db = createTestDb();
    insert(db, 'CREATE', null, '{"id":1}');
    const row = db.prepare('SELECT created_at FROM zone_change_log WHERE id = 1').get() as {
      created_at: string;
    };
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
