import type { Incident } from '@home-guardian/domain';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/errors/AppError.js';
import type { IncidentRepository } from '../../src/repositories/incidentRepository.js';
import type { RobotCatalogRepository } from '../../src/repositories/robotCatalogRepository.js';
import { createIncidentExportService } from '../../src/services/incidentExportService.js';

// Spec 007 — T4: servicio de exportación con repositorio, catálogo y reloj falsos
// (CA-07.2, CA-07.5, CA-07.8).

const sample: Incident = {
  id: 7,
  robotId: 1,
  robotName: 'Aspiradora A1',
  rule: 'R-ZONA-01',
  zoneName: 'Escaleras',
  decisionCode: 'TRAJECTORY_CROSSES_ZONE',
  severity: 'HIGH',
  collisionType: 'TRAJECTORY_CROSSES_ZONE',
  stateAfter: 'SAFE_STOP',
  origin: { x: 120, y: 90 },
  destination: { x: 110, y: 400 },
  reason: 'cruza',
  createdAt: '2026-11-23T10:00:00.000Z',
};

function setup(existingRobots: number[] = [1, 2]) {
  const incidents = {
    create: vi.fn(),
    findAll: vi.fn((): Incident[] => [sample]),
    findById: vi.fn(),
  } satisfies IncidentRepository;
  const catalog = {
    findById: vi.fn((id: number) =>
      existingRobots.includes(id)
        ? ({ id } as ReturnType<RobotCatalogRepository['findById']>)
        : null,
    ),
  } satisfies Pick<RobotCatalogRepository, 'findById'>;
  const service = createIncidentExportService({
    incidents,
    catalog,
    now: () => new Date('2026-11-23T23:59:59Z'),
  });
  return { service, incidents, catalog };
}

describe('incidentExportService.exportCsv (T4)', () => {
  it('CA-07.5 el nombre usa la fecha UTC del reloj inyectado', () => {
    const { service } = setup();
    expect(service.exportCsv({}).filename).toBe('incidentes-2026-11-23.csv');
  });

  it('CA-07.1 el cuerpo es el CSV de los incidentes leídos', () => {
    const { service } = setup();
    const { body } = service.exportCsv({});
    expect(body.startsWith('\uFEFFid,robotId,')).toBe(true);
    expect(body.split('\r\n')[1]).toMatch(/^7,1,Aspiradora A1,/);
  });

  it('CA-07.2 sin filtro lee todos los incidentes', () => {
    const { service, incidents, catalog } = setup();
    service.exportCsv({});
    expect(incidents.findAll).toHaveBeenCalledWith({});
    expect(catalog.findById).not.toHaveBeenCalled();
  });

  it('CA-07.2 con robotId pasa el mismo filtro a findAll', () => {
    const { service, incidents } = setup();
    service.exportCsv({ robotId: 2 });
    expect(incidents.findAll).toHaveBeenCalledWith({ robotId: 2 });
  });

  it('CA-07.2 robot inexistente → ROBOT_NOT_FOUND y no lee incidentes', () => {
    const { service, incidents } = setup();
    let error: unknown;
    try {
      service.exportCsv({ robotId: 999 });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 404, code: 'ROBOT_NOT_FOUND' });
    expect(incidents.findAll).not.toHaveBeenCalled();
  });

  it('CA-07.8 solo lectura: nunca llama a create', () => {
    const { service, incidents } = setup();
    service.exportCsv({});
    service.exportCsv({ robotId: 1 });
    expect(incidents.create).not.toHaveBeenCalled();
    expect(incidents.findById).not.toHaveBeenCalled();
  });
});
