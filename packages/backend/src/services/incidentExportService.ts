import type { IncidentListQuery } from '@home-guardian/domain';
import { robotNotFound } from '../errors/AppError.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';
import type { RobotCatalogRepository } from '../repositories/robotCatalogRepository.js';
import { incidentsToCsv } from '../rules/incidentCsv.js';

/** Dependencias inyectadas (SOLID-D). `now` permite fijar la fecha del nombre en pruebas (I-8). */
export interface IncidentExportServiceDeps {
  incidents: Pick<IncidentRepository, 'findAll'>;
  catalog: Pick<RobotCatalogRepository, 'findById'>;
  now: () => Date;
}

export interface IncidentCsvExport {
  filename: string;
  body: string;
}

export interface IncidentExportService {
  exportCsv(filter: IncidentListQuery): IncidentCsvExport;
}

/**
 * Spec 007 (HU-07) — exportación CSV de solo lectura sobre el mismo alcance que
 * GET /api/incidents (CA-07.2). No escribe en `incidents` ni en `audit_log` (CA-07.8).
 */
export function createIncidentExportService(
  deps: IncidentExportServiceDeps,
): IncidentExportService {
  return {
    exportCsv(filter) {
      const { robotId } = filter;
      if (robotId !== undefined && deps.catalog.findById(robotId) === null) {
        throw robotNotFound(robotId);
      }
      const incidents = deps.incidents.findAll(robotId === undefined ? {} : { robotId });
      return {
        // CA-07.5: fecha de generación en UTC.
        filename: `incidentes-${deps.now().toISOString().slice(0, 10)}.csv`,
        body: incidentsToCsv(incidents),
      };
    },
  };
}
