import type { Zone } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import {
  createIncidentRepository,
  type IncidentInput,
  type IncidentRepository,
} from '../../src/repositories/incidentRepository.js';
import { createDbBefore, createTestDb } from '../helpers.js';

const zone: Zone = {
  id: 1,
  name: 'Escaleras',
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  active: true,
  createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
};

const baseInput: IncidentInput = {
  robotId: 1,
  rule: 'R-ZONA-01',
  zoneName: 'Escaleras',
  decisionCode: 'RESTRICTED_ZONE_VIOLATION',
  collisionType: 'RESTRICTED_ZONE_VIOLATION',
  stateAfter: 'SAFE_STOP',
  origin: { x: 10, y: 20 },
  destination: { x: 150, y: 150 },
  zonesSnapshot: [zone],
  reason: 'El destino entra en una zona restringida: Escaleras',
};

describe('incidentRepository (RC-14: robot, regla, zona)', () => {
  let db: Db;
  let repo: IncidentRepository;
  beforeEach(() => {
    db = createTestDb();
    repo = createIncidentRepository(db);
  });

  it('crea un incidente con robot_id, rule y zone_name y devuelve el detalle con robotName', () => {
    const incident = repo.create(baseInput);
    expect(incident.id).toBe(1);
    expect(incident).toMatchObject({
      robotId: 1,
      robotName: 'Aspiradora A1',
      rule: 'R-ZONA-01',
      zoneName: 'Escaleras',
      decisionCode: 'RESTRICTED_ZONE_VIOLATION',
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      stateAfter: 'SAFE_STOP',
      origin: { x: 10, y: 20 },
      destination: { x: 150, y: 150 },
      reason: baseInput.reason,
    });
    expect(incident.zonesSnapshot).toEqual([zone]);
    expect(incident.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('persiste collisionType y zoneName nulos en denegaciones por datos', () => {
    const incident = repo.create({
      ...baseInput,
      rule: 'R-DATA-01',
      zoneName: null,
      decisionCode: 'ZONE_DATA_UNAVAILABLE',
      collisionType: null,
      zonesSnapshot: [],
    });
    expect(incident.collisionType).toBeNull();
    expect(incident.zoneName).toBeNull();
    expect(incident.zonesSnapshot).toEqual([]);
  });

  it('admite el incidente de pérdida de señal (POSITION_QUALITY_LOST, R-SIGNAL-01)', () => {
    const incident = repo.create({
      ...baseInput,
      robotId: 2,
      rule: 'R-SIGNAL-01',
      zoneName: null,
      decisionCode: 'POSITION_QUALITY_LOST',
      collisionType: null,
      stateAfter: 'DEGRADED',
      destination: baseInput.origin,
      zonesSnapshot: [],
    });
    expect(incident).toMatchObject({
      robotId: 2,
      robotName: 'Vigilante V2',
      rule: 'R-SIGNAL-01',
      decisionCode: 'POSITION_QUALITY_LOST',
    });
  });

  it('findAll devuelve del más reciente al más antiguo', () => {
    repo.create(baseInput);
    repo.create({ ...baseInput, reason: 'segundo' });
    repo.create({ ...baseInput, reason: 'tercero' });
    expect(repo.findAll().map((i) => i.id)).toEqual([3, 2, 1]);
    expect(repo.findAll().map((i) => i.reason)).toEqual(['tercero', 'segundo', baseInput.reason]);
  });

  it('findAll no incluye zonesSnapshot (resumen); findById sí (detalle)', () => {
    repo.create(baseInput);
    expect(repo.findAll()[0]).not.toHaveProperty('zonesSnapshot');
    expect(repo.findById(1)?.zonesSnapshot).toEqual([zone]);
  });

  it('findAll filtra por robotId', () => {
    repo.create(baseInput);
    repo.create({ ...baseInput, robotId: 2, reason: 'de V2' });
    repo.create(baseInput);
    expect(repo.findAll({ robotId: 2 }).map((i) => i.reason)).toEqual(['de V2']);
    expect(repo.findAll({ robotId: 1 }).map((i) => i.id)).toEqual([3, 1]);
    expect(repo.findAll({})).toHaveLength(3);
  });

  it('findById devuelve null si el incidente no existe', () => {
    expect(repo.findById(99)).toBeNull();
  });

  it('las filas nuevas exigen robot y regla (se valida en el repositorio)', () => {
    const bad = (over: object) => ({ ...baseInput, ...over }) as unknown as IncidentInput;
    expect(() => repo.create(bad({ robotId: null }))).toThrow(/robotId/);
    expect(() => repo.create(bad({ rule: null }))).toThrow(/rule/);
    expect(() => repo.create(bad({ robotId: 99 }))).toThrow(/FOREIGN KEY/);
    expect(repo.findAll()).toEqual([]);
  });

  it('es inmutable: la base rechaza UPDATE y DELETE (append-only, R5.4)', () => {
    repo.create(baseInput);
    expect(() => db.prepare('UPDATE incidents SET reason = ? WHERE id = 1').run('x')).toThrow(
      /append-only/,
    );
    expect(() => db.prepare('DELETE FROM incidents WHERE id = 1').run()).toThrow(/append-only/);
  });

  it('trata el motivo como dato, no como SQL', () => {
    const reason = "x'); DROP TABLE incidents; --";
    repo.create({ ...baseInput, reason });
    expect(repo.findAll()).toHaveLength(1);
    expect(repo.findAll()[0]?.reason).toBe(reason);
  });
});

describe('incidentRepository con incidentes anteriores al refuerzo (filas antiguas)', () => {
  it('robotId y robotName nulos, rule derivada del decision_code y fecha en ISO', () => {
    const db = createDbBefore('009');
    db.prepare(
      `INSERT INTO incidents (decision_code, collision_type, state_after, origin_x, origin_y, dest_x, dest_y, zones_snapshot, reason, created_at)
       VALUES ('TRAJECTORY_CROSSES_ZONE', 'TRAJECTORY_CROSSES_ZONE', 'SAFE_STOP', 1, 2, 3, 4, '[]', 'antiguo', '2025-03-04 05:06:07'),
              ('MISSING_POSITION', NULL, 'DEGRADED', 1, 2, 3, 4, '[]', 'antiguo 2', '2025-03-04 05:06:08'),
              ('ZONE_DATA_UNAVAILABLE', NULL, 'SAFE_STOP', 1, 2, 3, 4, '[]', 'antiguo 3', '2025-03-04 05:06:09')`,
    ).run();
    migrate(db);
    const repo = createIncidentRepository(db);

    const all = repo.findAll();
    expect(all.map((i) => i.rule)).toEqual(['R-DATA-01', 'R-SIGNAL-01', 'R-ZONA-01']);
    expect(all[2]).toMatchObject({
      id: 1,
      robotId: null,
      robotName: null,
      zoneName: null,
      createdAt: '2025-03-04T05:06:07.000Z',
    });
    // Las filas antiguas no se reescriben (siguen con NULL en la base).
    expect(
      db.prepare('SELECT robot_id, rule, zone_name FROM incidents WHERE id = 1').get(),
    ).toEqual({
      robot_id: null,
      rule: null,
      zone_name: null,
    });
    // Conviven con las nuevas, que van primero (más recientes).
    const created = repo.create({ ...baseInput });
    expect(repo.findAll().map((i) => i.id)).toEqual([created.id, 3, 2, 1]);
    expect(repo.findById(1)?.rule).toBe('R-ZONA-01');
  });
});
