import {
  robotIdParamSchema,
  type MoveBody,
  type MoveCommand,
  type PositionBody,
  type ServiceResult,
} from '@home-guardian/domain';
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
/** Robot al que sirven las rutas antiguas `/api/robot/*` hasta su retirada en RC-20 (A1). */
const LEGACY_ROBOT_ID = 1;

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
    // ── Handlers por robot: /api/robots/:robotId/* (spec 002 RC-16) ─────────────────────────
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

    // ── Handlers legacy: /api/robot/* sobre A1 (se retiran en RC-20) ────────────────────────
    /** GET /api/robot/state — estado, posición y calidad de posición (200). */
    getState(_req: Request, res: Response): void {
      res.json(service.getState(LEGACY_ROBOT_ID));
    },
    /** POST /api/robot/move — AUTHORIZED/DENIED → 200, REJECTED → 409 (R1.5, R3.3). */
    move(req: Request, res: Response): void {
      // Vía temporal sin sesión (decisión 2): el único llamador de `moveLegacy`.
      const outcome = service.moveLegacy(LEGACY_ROBOT_ID, (req.body as MoveBody).destination);
      res.status(outcome.decision === 'REJECTED' ? 409 : 200).json(outcome);
    },
    /** POST /api/robot/recover — OK (o IDLE sin efecto) → 200, rechazo → 409 con `cause` (R4). */
    recover(_req: Request, res: Response): void {
      const result = service.recover(LEGACY_ROBOT_ID);
      if (result.kind === 'ok') {
        res.json(result.value);
        return;
      }
      res.status(result.status).json(rejectionBody(result));
    },
    /** POST /api/robot/position — lectura aceptada → 200, `POSITION_CONFLICT` → 409 (R8). */
    position(req: Request, res: Response): void {
      const result = service.setPosition(LEGACY_ROBOT_ID, req.body as PositionBody);
      if (result.kind === 'ok') {
        res.json(result.value);
        return;
      }
      res.status(result.status).json(rejectionBody(result));
    },
  };
}
