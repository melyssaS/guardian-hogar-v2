import type { IncidentListQuery } from '@home-guardian/domain';
import type { Request, Response } from 'express';
import { incidentNotFound, robotNotFound } from '../errors/AppError.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';
import type { RobotCatalogRepository } from '../repositories/robotCatalogRepository.js';

/**
 * Solo recibe y responde; lee del repositorio append-only (SOLID-S, R5.1). La validación de
 * `req.query`/`req.params` (Zod) la hace la ruta; aquí `query.robotId` y `params.id` ya son números.
 */
export function createIncidentController(
  incidents: IncidentRepository,
  catalog: Pick<RobotCatalogRepository, 'findById'>,
) {
  return {
    /**
     * GET /api/incidents[?robotId=][&severity=] — del más reciente al más antiguo (R5.6). Solo
     * transporta los filtros; la severidad la deriva y filtra el repositorio (spec 006 DD-606).
     */
    list(req: Request, res: Response): void {
      const { robotId, severity } = req.query as IncidentListQuery;
      if (robotId !== undefined && catalog.findById(robotId) === null) throw robotNotFound(robotId);
      res.json(
        incidents.findAll({
          ...(robotId === undefined ? {} : { robotId }),
          ...(severity === undefined ? {} : { severity }),
        }),
      );
    },
    /** GET /api/incidents/:id — detalle con `zonesSnapshot` (R5.7). */
    get(req: Request, res: Response): void {
      const id = (req.params as unknown as { id: number }).id;
      const incident = incidents.findById(id);
      if (incident === null) throw incidentNotFound(id);
      res.json(incident);
    },
  };
}
