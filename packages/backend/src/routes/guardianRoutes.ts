import { moveCommandSchema, positionSchema, robotIdParamSchema } from '@home-guardian/domain';
import { Router } from 'express';
import { createRobotController } from '../controllers/robotController.js';
import { invalidMoveRequest, invalidPosition } from '../errors/AppError.js';
import { validate } from '../middlewares/validate.js';
import type { GuardianService } from '../services/guardianService.js';

/**
 * /api/robots/:robotId/{state,move,recover,position} — contrato por robot de la spec 002 §6
 * (R11, R12.3). Se monta bajo `/api/robots/:robotId`, de ahí `mergeParams`. `/sessions` lo monta
 * la spec 003 en `robotsRoutes` (dueña única). Orden de validación de `move` (R11.5): Zod (422) →
 * robot existe (404) → límites del plano (422) → sesión y secuencia (409) → vigilante; los tres
 * últimos pasos los ejecuta el servicio.
 */
export function createGuardianRoutes(service: GuardianService): Router {
  const c = createRobotController(service);
  const router = Router({ mergeParams: true });

  router.use(validate(robotIdParamSchema, 'params'));
  router.get('/state', c.getRobotState);
  router.post('/move', validate(moveCommandSchema, 'body', invalidMoveRequest), c.moveRobot);
  router.post('/recover', c.recoverRobot);
  router.post('/position', validate(positionSchema, 'body', invalidPosition), c.positionRobot);

  return router;
}
