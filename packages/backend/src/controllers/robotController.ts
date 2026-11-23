import {
  robotIdParamSchema,
  type MoveCommand,
  type PositionBody,
  type ServiceResult,
} from '@home-guardian/domain';
import type { Request, Response } from 'express';
import type { GuardianService } from '../services/guardianService.js';

/**
 * Solo recibe y responde (SOLID-S). Mapeo decisión → HTTP (design §7, DD-203):
 * `AUTHORIZED` y `DENIED` → 200 (la denegación es una decisión válida con su cuerpo);
 * `REJECTED` (SAFE_STOP_ACTIVE/BUSY) → 409 (conflicto de estado). `getRobotState`, `recover`
 * exitoso y `position` → 200. El payload inválido lo convierte la ruta (Zod) en 422
 * INVALID_MOVE_REQUEST/INVALID_POSITION; los AppError del servicio (destino fuera del plano)
 * se propagan al errorHandler, que responde `{ code, message }` sin stack trace (R7.2).
 */
/** Cuerpo `{ code, message, cause? }` de un resultado rechazado (409 sin estado ni posición). */
function rejectionBody(result: Extract<ServiceResult<unknown>, { kind: 'rejected' }>) {
  return result.cause === undefined
    ? { code: result.code, message: result.message }
    : { code: result.code, cause: result.cause, message: result.message };
}

/** `:robotId` ya validado por la ruta (entero positivo); se coacciona porque Express lo da como texto. */
function robotIdOf(req: Request): number {
  return robotIdParamSchema.parse(req.params).robotId;
}

export function createRobotController(service: GuardianService) {
  return {
    /** GET /api/robots/:robotId/state — `RobotStatus` con `lastRequest` (200, R12.3). */
    getRobotState(req: Request, res: Response): void {
      res.json(service.getStatus(robotIdOf(req)));
    },
    /**
     * POST /api/robots/:robotId/move — AUTHORIZED/DENIED → 200, REJECTED (estado) → 409 con la
     * decisión, sesión inválida o secuencia duplicada → 409 `{ code, message }` (R11).
     */
    moveRobot(req: Request, res: Response): void {
      const result = service.move(robotIdOf(req), req.body as MoveCommand);
      if ('kind' in result) {
        res.status(result.status).json(rejectionBody(result));
        return;
      }
      res.status(result.decision === 'REJECTED' ? 409 : 200).json(result);
    },
    /** POST /api/robots/:robotId/recover — OK o IDLE sin efecto → 200, rechazo → 409 (R4). */
    recoverRobot(req: Request, res: Response): void {
      const result = service.recover(robotIdOf(req));
      if (result.kind === 'ok') {
        res.json(result.value);
        return;
      }
      res.status(result.status).json(rejectionBody(result));
    },
    /** POST /api/robots/:robotId/position — lectura aceptada → 200, conflicto → 409 (R8). */
    positionRobot(req: Request, res: Response): void {
      const result = service.setPosition(robotIdOf(req), req.body as PositionBody);
      if (result.kind === 'ok') {
        res.json(result.value);
        return;
      }
      res.status(result.status).json(rejectionBody(result));
    },
  };
}
