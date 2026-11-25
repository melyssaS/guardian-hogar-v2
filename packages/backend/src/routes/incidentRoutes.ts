import { incidentIdParamSchema, incidentListQuerySchema } from '@home-guardian/domain';
import { Router } from 'express';
import { createIncidentController } from '../controllers/incidentController.js';
import { validate } from '../middlewares/validate.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';
import type { RobotCatalogRepository } from '../repositories/robotCatalogRepository.js';

/** /api/incidents — contrato de API de la spec 002 §6 (listado y detalle, solo lectura). */
export function createIncidentRoutes(
  incidents: IncidentRepository,
  catalog: Pick<RobotCatalogRepository, 'findById'>,
): Router {
  const c = createIncidentController(incidents, catalog);
  const router = Router();

  router.get('/', validate(incidentListQuerySchema, 'query'), c.list);
  // HU-08: /counts debe ir ANTES de /:id para que el parámetro `:id` no capture "counts" (DD-08.5).
  router.get('/counts', c.counts);
  router.get('/:id', validate(incidentIdParamSchema, 'params'), c.get);

  return router;
}
