import { incidentIdParamSchema, incidentListQuerySchema } from '@home-guardian/domain';
import { Router } from 'express';
import { createIncidentController } from '../controllers/incidentController.js';
import { validate } from '../middlewares/validate.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';
import type { RobotCatalogRepository } from '../repositories/robotCatalogRepository.js';
import type { IncidentExportService } from '../services/incidentExportService.js';

/**
 * /api/incidents — contrato de API de la spec 002 §6 (listado y detalle, solo lectura) y
 * exportación CSV de la spec 007 (`exporter` lo inyecta `app.ts`).
 */
export function createIncidentRoutes(
  incidents: IncidentRepository,
  catalog: Pick<RobotCatalogRepository, 'findById'>,
  exporter?: IncidentExportService,
): Router {
  const c = createIncidentController(incidents, catalog, exporter);
  const router = Router();

  router.get('/', validate(incidentListQuerySchema, 'query'), c.list);
  // Spec 007: antes de `/:id`, si no `export` se validaría como id (422).
  router.get('/export', validate(incidentListQuerySchema, 'query'), c.exportCsv);
  router.get('/:id', validate(incidentIdParamSchema, 'params'), c.get);

  return router;
}
