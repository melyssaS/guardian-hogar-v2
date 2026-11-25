import type { Incident, IncidentDetail } from '@home-guardian/domain';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createIncidentController } from '../../src/controllers/incidentController.js';
import type { IncidentRepository } from '../../src/repositories/incidentRepository.js';
import type { RobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';

const summary: Incident = {
  id: 1,
  robotId: 1,
  robotName: 'Aspiradora A1',
  rule: 'R-ZONA-01',
  zoneName: 'Escaleras',
  decisionCode: 'RESTRICTED_ZONE_VIOLATION',
  severity: 'HIGH',
  collisionType: 'RESTRICTED_ZONE_VIOLATION',
  stateAfter: 'SAFE_STOP',
  origin: { x: 10, y: 20 },
  destination: { x: 150, y: 150 },
  reason: 'El destino entra en una zona restringida: Escaleras',
  createdAt: '2024-01-01T00:00:00.000Z',
};
const detail: IncidentDetail = { ...summary, zonesSnapshot: [] };

const catalog = (known: number[]): Pick<RobotCatalogRepository, 'findById'> => ({
  findById: (id) =>
    known.includes(id) ? { id, name: 'x', type: 'VACUUM', createdAt: summary.createdAt } : null,
});

describe('incidentController', () => {
  it('R5.6 list responde con lo que devuelve findAll() sin filtro', () => {
    const findAll = vi.fn(() => [summary]);
    const controller = createIncidentController(
      { findAll } as unknown as IncidentRepository,
      catalog([1]),
    );
    const json = vi.fn();
    controller.list({ query: {} } as unknown as Request, { json } as unknown as Response);
    expect(findAll).toHaveBeenCalledWith({});
    expect(json).toHaveBeenCalledWith([summary]);
  });

  it('R5.6 list con robotId existente filtra por ese robot', () => {
    const findAll = vi.fn(() => [summary]);
    const controller = createIncidentController(
      { findAll } as unknown as IncidentRepository,
      catalog([1]),
    );
    const json = vi.fn();
    controller.list(
      { query: { robotId: 1 } } as unknown as Request,
      {
        json,
      } as unknown as Response,
    );
    expect(findAll).toHaveBeenCalledWith({ robotId: 1 });
  });

  it('R5.6 list con robotId inexistente lanza 404 ROBOT_NOT_FOUND sin consultar incidentes', () => {
    const findAll = vi.fn();
    const controller = createIncidentController(
      { findAll } as unknown as IncidentRepository,
      catalog([1]),
    );
    expect(() =>
      controller.list({ query: { robotId: 9 } } as unknown as Request, {} as Response),
    ).toThrowError(expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }));
    expect(findAll).not.toHaveBeenCalled();
  });

  // Spec 006 — HU-06, tarea 7 (CA-06.1, CA-06.7): el controlador solo transporta el filtro.
  it('CA-06.1 list pasa severity al repositorio y responde sin filtrar por su cuenta', () => {
    const findAll = vi.fn(() => [summary]);
    const controller = createIncidentController(
      { findAll } as unknown as IncidentRepository,
      catalog([1]),
    );
    const json = vi.fn();
    controller.list(
      { query: { severity: 'LOW' } } as unknown as Request,
      { json } as unknown as Response,
    );
    expect(findAll).toHaveBeenCalledWith({ severity: 'LOW' });
    // `summary` es HIGH: si el controlador filtrara por su cuenta, no lo devolvería.
    expect(json).toHaveBeenCalledWith([summary]);
  });

  it('CA-06.7 list con robotId existente y severity pasa ambos', () => {
    const findAll = vi.fn(() => [summary]);
    const controller = createIncidentController(
      { findAll } as unknown as IncidentRepository,
      catalog([1]),
    );
    controller.list(
      { query: { robotId: 1, severity: 'HIGH' } } as unknown as Request,
      { json: vi.fn() } as unknown as Response,
    );
    expect(findAll).toHaveBeenCalledWith({ robotId: 1, severity: 'HIGH' });
  });

  it('CA-06.7 con robotId inexistente y severity lanza 404 sin consultar incidentes', () => {
    const findAll = vi.fn();
    const controller = createIncidentController(
      { findAll } as unknown as IncidentRepository,
      catalog([1]),
    );
    expect(() =>
      controller.list(
        { query: { robotId: 9, severity: 'HIGH' } } as unknown as Request,
        {} as Response,
      ),
    ).toThrowError(expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }));
    expect(findAll).not.toHaveBeenCalled();
  });

  it('R5.7 get responde con el detalle y lanza 404 INCIDENT_NOT_FOUND si no existe', () => {
    const findById = vi.fn((id: number) => (id === 1 ? detail : null));
    const controller = createIncidentController(
      { findById } as unknown as IncidentRepository,
      catalog([]),
    );
    const json = vi.fn();
    controller.get({ params: { id: 1 } } as unknown as Request, { json } as unknown as Response);
    expect(json).toHaveBeenCalledWith(detail);
    expect(() =>
      controller.get({ params: { id: 2 } } as unknown as Request, {} as Response),
    ).toThrowError(expect.objectContaining({ status: 404, code: 'INCIDENT_NOT_FOUND' }));
  });
});
