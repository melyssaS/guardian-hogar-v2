import { robotIdParamSchema, robotInputSchema } from '@home-guardian/domain';
import { Router } from 'express';
import {
  createRobotsController,
  type RobotsControllerDeps,
} from '../controllers/robotsController.js';
import { invalidRobot } from '../errors/AppError.js';
import { validate } from '../middlewares/validate.js';

/**
 * /api/robots — catálogo de robots y sesiones (spec 003 §5; dueña única de `/:robotId/sessions`).
 * `state|move|recover|position` los monta `guardianRoutes` (spec 002) bajo `/api/robots/:robotId`.
 * Orden del alta (RF-07.10): payload (422 `INVALID_ROBOT`) → el resto lo decide el servicio.
 */
export function createRobotsRoutes(deps: RobotsControllerDeps): Router {
  const c = createRobotsController(deps);
  const router = Router();

  router.get('/', c.list);
  router.post('/', validate(robotInputSchema, 'body', invalidRobot), c.create);
  router.get('/:robotId', validate(robotIdParamSchema, 'params'), c.get);
  router.post('/:robotId/sessions', validate(robotIdParamSchema, 'params'), c.startSession);

  return router;
}
