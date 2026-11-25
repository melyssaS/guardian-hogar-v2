import { incidentIdParamSchema, incidentListQuerySchema } from '@home-guardian/domain';
import { Router } from 'express';
import { createIncidentController } from '../controllers/incidentController.js';
import { invalidSeverityFilter, validationError } from '../errors/AppError.js';
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

  // Spec 006 DD-604/605: un solo esquema (`robotId` primero). `validate` compone el mensaje como
  // "<path>: <detalle>"; si el primer problema es de `severity` el código es INVALID_SEVERITY_FILTER,
  // y si es de `robotId` (también cuando ambos fallan) se conserva VALIDATION_ERROR.
  const listQueryError = (message: string) =>
    message.startsWith('severity') ? invalidSeverityFilter(message) : validationError(message);
  router.get('/', validate(incidentListQuerySchema, 'query', listQueryError), c.list);
  // Las rutas literales van ANTES de `/:id` para que el parámetro no las capture.
  // Spec 007: exportación CSV. HU-08 (DD-08.5): conteos por tipo.
  router.get('/export', validate(incidentListQuerySchema, 'query'), c.exportCsv);
  router.get('/counts', c.counts);
  router.get('/:id', validate(incidentIdParamSchema, 'params'), c.get);

  return router;
}
