import type { MoveRequestBody } from '@home-guardian/domain';
import type { Request, Response } from 'express';
import type { MovementService } from '../services/movementService.js';

/**
 * Solo recibe y responde (SOLID-S). Mapeo decisión → HTTP:
 * ALLOW y PREVENTIVE_STOP → 200 (DD-101); DENIED_SAFE_STOP → 409 con el MoveResult (DD-102).
 */
export function createSimulationController(service: MovementService) {
  return {
    getRobot(_req: Request, res: Response) {
      res.json(service.getRobot());
    },
    move(req: Request, res: Response) {
      const result = service.move((req.body as MoveRequestBody).destination);
      res.status(result.decision === 'DENIED_SAFE_STOP' ? 409 : 200).json(result);
    },
    reset(_req: Request, res: Response) {
      res.json(service.reset());
    },
  };
}
