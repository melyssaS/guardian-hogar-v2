import type { MoveBody, PositionBody } from '@home-guardian/domain';
import type { Request, Response } from 'express';
import type { GuardianService } from '../services/guardianService.js';

/**
 * Solo recibe y responde (SOLID-S). Mapeo decisión → HTTP (design §7, DD-203):
 * `AUTHORIZED` y `DENIED` → 200 (la denegación es una decisión válida con su cuerpo);
 * `REJECTED` (SAFE_STOP_ACTIVE/BUSY) → 409 (conflicto de estado). `getState`, `recover`
 * exitoso y `position` → 200. El payload inválido lo convierte la ruta (Zod) en 422
 * INVALID_DESTINATION/INVALID_POSITION; los AppError del servicio (destino fuera del plano)
 * se propagan al errorHandler, que responde `{ code, message }` sin stack trace (R7.2).
 */
export function createRobotController(service: GuardianService) {
  return {
    /** GET /api/robot/state — estado, posición y calidad de posición (200). */
    getState(_req: Request, res: Response): void {
      res.json(service.getState());
    },
    /** POST /api/robot/move — AUTHORIZED/DENIED → 200, REJECTED → 409 (R1.5, R3.3). */
    move(req: Request, res: Response): void {
      const outcome = service.move((req.body as MoveBody).destination);
      res.status(outcome.decision === 'REJECTED' ? 409 : 200).json(outcome);
    },
    /** POST /api/robot/recover — recuperación OK → 200, rechazo → 409 (R4). */
    recover(_req: Request, res: Response): void {
      const outcome = service.recover();
      res.status(outcome.recovered ? 200 : 409).json(outcome);
    },
    /** POST /api/robot/position — fija posición y calidad (200, R8.2). */
    position(req: Request, res: Response): void {
      res.json(service.setPosition(req.body as PositionBody));
    },
  };
}
