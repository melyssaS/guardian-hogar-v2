import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createIncidentController } from '../../src/controllers/incidentController.js';
import type { Incident, IncidentRepository } from '../../src/repositories/incidentRepository.js';

const incident: Incident = {
  id: 1,
  decisionCode: 'RESTRICTED_ZONE_VIOLATION',
  collisionType: 'RESTRICTED_ZONE_VIOLATION',
  stateAfter: 'SAFE_STOP',
  origin: { x: 10, y: 20 },
  destination: { x: 150, y: 150 },
  zonesSnapshot: [],
  reason: 'El destino entra en una zona restringida: Escaleras',
  createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
};

describe('incidentController', () => {
  it('R5.1 list responde con lo que devuelve findAll()', () => {
    const incidents = { findAll: () => [incident] } as unknown as IncidentRepository;
    const json = vi.fn();
    const controller = createIncidentController(incidents);

    controller.list({} as Request, { json } as unknown as Response);

    expect(json).toHaveBeenCalledWith([incident]);
  });
});
