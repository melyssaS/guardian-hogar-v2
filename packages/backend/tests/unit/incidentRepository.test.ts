import type { Zone } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createIncidentRepository,
  type IncidentInput,
  type IncidentRepository,
} from '../../src/repositories/incidentRepository.js';
import { createTestDb } from '../helpers.js';
import type { Db } from '../../src/db/connection.js';

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
  decisionCode: 'RESTRICTED_ZONE_VIOLATION',
  collisionType: 'RESTRICTED_ZONE_VIOLATION',
  stateAfter: 'SAFE_STOP',
  origin: { x: 10, y: 20 },
  destination: { x: 150, y: 150 },
  zonesSnapshot: [zone],
  reason: 'El destino entra en una zona restringida: Escaleras',
};

describe('incidentRepository', () => {
  let db: Db;
  let repo: IncidentRepository;
  beforeEach(() => {
    db = createTestDb();
    repo = createIncidentRepository(db);
  });

  it('crea un incidente con id y round-trip del snapshot JSON', () => {
    const incident = repo.create(baseInput);
    expect(incident.id).toBe(1);
    expect(incident).toMatchObject({
      decisionCode: 'RESTRICTED_ZONE_VIOLATION',
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      stateAfter: 'SAFE_STOP',
      origin: { x: 10, y: 20 },
      destination: { x: 150, y: 150 },
      reason: baseInput.reason,
    });
    expect(incident.zonesSnapshot).toEqual([zone]);
    expect(new Date(incident.createdAt).toISOString()).toBe(incident.createdAt);
  });

  it('persiste collisionType nulo en denegaciones por datos', () => {
    const incident = repo.create({
      ...baseInput,
      decisionCode: 'ZONE_DATA_UNAVAILABLE',
      collisionType: null,
      zonesSnapshot: [],
    });
    expect(incident.collisionType).toBeNull();
    expect(incident.zonesSnapshot).toEqual([]);
  });

  it('findAll devuelve los incidentes insertados en orden', () => {
    repo.create(baseInput);
    repo.create({ ...baseInput, reason: 'segundo' });
    const all = repo.findAll();
    expect(all.map((i) => i.id)).toEqual([1, 2]);
    expect(all.map((i) => i.reason)).toEqual([baseInput.reason, 'segundo']);
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
