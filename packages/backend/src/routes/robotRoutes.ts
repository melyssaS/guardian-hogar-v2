import { moveSchema, positionSchema } from '@home-guardian/domain';
import { Router } from 'express';
import { createRobotController } from '../controllers/robotController.js';
import { invalidDestination, invalidPosition } from '../errors/AppError.js';
import { validate } from '../middlewares/validate.js';
import type { GuardianService } from '../services/guardianService.js';

/**
 * /api/robot — contrato de API de la spec 002 §6, §6.1, §8.1 (vigilante de seguridad).
 *
 * Zod valida solo la forma del cuerpo (punto/calidad); los límites del plano los verifica el
 * servicio, que lanza 422 (DESTINATION_OUT_OF_BOUNDS/INVALID_POSITION) hacia el errorHandler.
 */
export function createRobotRoutes(service: GuardianService): Router {
  const c = createRobotController(service);
  const router = Router();

  router.get('/state', c.getState);
  router.post('/move', validate(moveSchema, 'body', invalidDestination), c.move);
  router.post('/recover', c.recover);
  router.post('/position', validate(positionSchema, 'body', invalidPosition), c.position);

  return router;
}
