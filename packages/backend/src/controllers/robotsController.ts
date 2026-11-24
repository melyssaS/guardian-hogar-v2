import { robotIdParamSchema, type RobotInput, type ServiceResult } from '@home-guardian/domain';
import type { Request, Response } from 'express';
import type { RobotCatalogService } from '../services/robotCatalogService.js';
import type { SessionService } from '../services/sessionService.js';

/** Dependencias del controller del catálogo y de las sesiones. */
export interface RobotsControllerDeps {
  catalog: RobotCatalogService;
  sessions: Pick<SessionService, 'startSession'>;
}

/** Cuerpo `{ code, message, cause? }` de un resultado rechazado (409). */
function rejectionBody(result: Extract<ServiceResult<unknown>, { kind: 'rejected' }>) {
  return result.cause === undefined
    ? { code: result.code, message: result.message }
    : { code: result.code, message: result.message, cause: result.cause };
}

/**
 * Solo recibe y responde (SOLID-S). El cuerpo y el `:robotId` ya los validó la ruta (Zod).
 * `GET /api/robots`, `POST /api/robots`, `GET /api/robots/:robotId` y `POST .../sessions`.
 */
export function createRobotsController({ catalog, sessions }: RobotsControllerDeps) {
  const robotIdOf = (req: Request): number => robotIdParamSchema.parse(req.params).robotId;
  return {
    /** GET /api/robots — catálogo con el estado actual de cada robot (200). */
    list(_req: Request, res: Response): void {
      res.json(catalog.list());
    },
    /** POST /api/robots — 201 con el robot y su estado inicial, o 409 (alta rechazada). */
    create(req: Request, res: Response): void {
      const result = catalog.register(req.body as RobotInput);
      if (result.kind === 'ok') {
        res.status(201).json(result.value);
        return;
      }
      res.status(result.status).json(rejectionBody(result));
    },
    /** GET /api/robots/:robotId — un robot con su estado y `lastRequest` (200 / 404). */
    get(req: Request, res: Response): void {
      res.json(catalog.get(robotIdOf(req)));
    },
    /** POST /api/robots/:robotId/sessions — nueva sesión; 201 `{ sessionId }`. */
    startSession(req: Request, res: Response): void {
      res.status(201).json(sessions.startSession(robotIdOf(req)));
    },
  };
}
