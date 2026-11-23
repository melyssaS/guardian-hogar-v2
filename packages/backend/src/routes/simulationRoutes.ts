import { moveRequestSchema } from '@home-guardian/domain';
import { Router } from 'express';
import { createSimulationController } from '../controllers/simulationController.js';
import { invalidDestination } from '../errors/AppError.js';
import { validate } from '../middlewares/validate.js';
import type { MovementService } from '../services/movementService.js';

/** /api/simulation — contrato de API de la spec 003 §5. */
export function createSimulationRoutes(service: MovementService): Router {
  const c = createSimulationController(service);
  const router = Router();

  router.get('/robot', c.getRobot);
  router.post('/move', validate(moveRequestSchema, 'body', invalidDestination), c.move);
  router.post('/reset', c.reset);

  return router;
}
