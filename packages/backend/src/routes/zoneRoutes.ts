import {
  createZoneSchema,
  listZoneQuerySchema,
  updateZoneSchema,
  zoneIdParamSchema,
} from '@home-guardian/domain';
import { Router } from 'express';
import { createZoneController } from '../controllers/zoneController.js';
import { validate } from '../middlewares/validate.js';
import type { ZoneService } from '../services/zoneService.js';

/** /api/zones — contrato de API de la spec 001 §5. */
export function createZoneRoutes(service: ZoneService): Router {
  const c = createZoneController(service);
  const router = Router();

  router.get('/', validate(listZoneQuerySchema, 'query'), c.list);
  router.post('/', validate(createZoneSchema), c.create);
  router.get('/:id', validate(zoneIdParamSchema, 'params'), c.get);
  router.put('/:id', validate(zoneIdParamSchema, 'params'), validate(updateZoneSchema), c.update);
  router.delete('/:id', validate(zoneIdParamSchema, 'params'), c.remove);

  return router;
}
