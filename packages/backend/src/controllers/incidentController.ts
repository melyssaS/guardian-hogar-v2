import type { IncidentListQuery } from '@home-guardian/domain';
import type { Request, Response } from 'express';
import { incidentNotFound, robotNotFound } from '../errors/AppError.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';
import type { RobotCatalogRepository } from '../repositories/robotCatalogRepository.js';
import {
  createIncidentExportService,
  type IncidentExportService,
} from '../services/incidentExportService.js';

/**
 * Solo recibe y responde; lee del repositorio append-only (SOLID-S, R5.1). La validación de
 * `req.query`/`req.params` (Zod) la hace la ruta; aquí `query.robotId` y `params.id` ya son números.
 */
export function createIncidentController(
  incidents: IncidentRepository,
  catalog: Pick<RobotCatalogRepository, 'findById'>,
  /** Spec 007. Por defecto, con el reloj del sistema (las pruebas previas no lo pasan). */
  exporter: IncidentExportService = createIncidentExportService({
    incidents,
    catalog,
    now: () => new Date(),
  }),
) {
  return {
    /** GET /api/incidents[?robotId=] — del más reciente al más antiguo (R5.6). */
    list(req: Request, res: Response): void {
      const { robotId } = req.query as IncidentListQuery;
      if (robotId !== undefined && catalog.findById(robotId) === null) throw robotNotFound(robotId);
      res.json(incidents.findAll(robotId === undefined ? {} : { robotId }));
    },
    /** GET /api/incidents/:id — detalle con `zonesSnapshot` (R5.7). */
    get(req: Request, res: Response): void {
      const id = (req.params as unknown as { id: number }).id;
      const incident = incidents.findById(id);
      if (incident === null) throw incidentNotFound(id);
      res.json(incident);
    },
    /** GET /api/incidents/export[?robotId=] — CSV de solo lectura (spec 007, CA-07.1, CA-07.5). */
    exportCsv(req: Request, res: Response): void {
      const { filename, body } = exporter.exportCsv(req.query as IncidentListQuery);
      res
        .status(200)
        .set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="${filename}"`)
        .send(body);
    },
  };
}
