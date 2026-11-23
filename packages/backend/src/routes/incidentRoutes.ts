import { Router } from 'express';
import { createIncidentController } from '../controllers/incidentController.js';
import type { IncidentRepository } from '../repositories/incidentRepository.js';

/** /api/incidents — contrato de API de la spec 002 §6 (listado de incidentes). */
export function createIncidentRoutes(incidents: IncidentRepository): Router {
  const c = createIncidentController(incidents);
  const router = Router();

  router.get('/', c.list);

  return router;
}
