import type {
  LastRequest,
  RecoverResponse,
  RobotStatus,
  ServiceResult,
} from '@home-guardian/domain';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createRobotController } from '../../src/controllers/robotController.js';
import type {
  GuardianService,
  PerRobotMoveOutcome,
  PositionOutcome,
} from '../../src/services/guardianService.js';

// Doble de Response que captura status y cuerpo (el controller solo recibe y responde).
function fakeRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

// Fake del servicio: cada método devuelve lo que la prueba configure.
function fakeService(overrides: Partial<GuardianService>): GuardianService {
  return {
    getStatus: vi.fn(),
    move: vi.fn(),
    recover: vi.fn(),
    setPosition: vi.fn(),
    checkStartPosition: vi.fn(),
    initRobot: vi.fn(),
    ...overrides,
  };
}

const POS = { x: 10, y: 20 };

describe('robotController — mapeo decisión → HTTP (DD-203)', () => {
  const params = (robotId: string) => ({ robotId });
  const command = {
    destination: POS,
    sessionId: '5f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    sequence: 1,
  };

  it('moveRobot DENIED → 200 (la denegación es una decisión válida)', () => {
    const outcome: PerRobotMoveOutcome = {
      decision: 'DENIED',
      code: 'RESTRICTED_ZONE_VIOLATION',
      state: 'SAFE_STOP',
      position: POS,
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      incidentId: 7,
      rule: 'R-ZONA-01',
      zoneName: 'Escaleras',
      reason: 'destination inside restricted zone',
      robotId: 1,
      positionQuality: 'RELIABLE',
    };
    const controller = createRobotController(fakeService({ move: () => outcome }));
    const res = fakeRes();
    controller.moveRobot({ params: params('1'), body: command } as unknown as Request, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(outcome);
  });

  it('recoverRobot exitoso → 200 con el RecoverResponse (transitioned)', () => {
    const value: RecoverResponse = {
      robotId: 1,
      state: 'IDLE',
      position: POS,
      positionQuality: 'RELIABLE',
      transitioned: true,
    };
    const controller = createRobotController(
      fakeService({ recover: () => ({ kind: 'ok', value }) }),
    );
    const res = fakeRes();
    controller.recoverRobot({ params: params('1') } as unknown as Request, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(value);
  });

  it('recoverRobot rechazado → 409 { code, cause, message } sin estado ni posición', () => {
    const outcome: ServiceResult<RecoverResponse> = {
      kind: 'rejected',
      code: 'RECOVERY_NOT_ALLOWED',
      status: 409,
      cause: 'UNSAFE_POSITION',
      message: 'Current position is inside a restricted zone',
    };
    const controller = createRobotController(fakeService({ recover: () => outcome }));
    const res = fakeRes();
    controller.recoverRobot({ params: params('1') } as unknown as Request, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      code: 'RECOVERY_NOT_ALLOWED',
      cause: 'UNSAFE_POSITION',
      message: 'Current position is inside a restricted zone',
    });
  });

  it('positionRobot → 200 con la lectura aportada', () => {
    const value: PositionOutcome = {
      state: 'IDLE',
      position: POS,
      positionQuality: 'RELIABLE',
    };
    const setPosition = vi.fn(() => ({ kind: 'ok' as const, value }));
    const controller = createRobotController(fakeService({ setPosition }));
    const res = fakeRes();
    const body = { position: POS, quality: 'RELIABLE' as const };
    controller.positionRobot({ params: params('1'), body } as unknown as Request, res);
    expect(setPosition).toHaveBeenCalledWith(1, body);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(value);
  });

  it('positionRobot rechazado con POSITION_CONFLICT → 409 { code, message }', () => {
    const outcome: ServiceResult<PositionOutcome> = {
      kind: 'rejected',
      code: 'POSITION_CONFLICT',
      status: 409,
      message: 'RELIABLE reading does not match the current position',
    };
    const controller = createRobotController(fakeService({ setPosition: () => outcome }));
    const res = fakeRes();
    const body = { position: POS, quality: 'RELIABLE' as const };
    controller.positionRobot({ params: params('1'), body } as unknown as Request, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      code: 'POSITION_CONFLICT',
      message: 'RELIABLE reading does not match the current position',
    });
  });
});

describe('robotController — handlers por robot (/api/robots/:robotId/*)', () => {
  const params = (robotId: string) => ({ robotId });
  const command = {
    destination: POS,
    sessionId: '5f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    sequence: 3,
  };

  it('getRobotState → 200 con el RobotStatus del robot indicado', () => {
    const status: RobotStatus = {
      robotId: 2,
      state: 'IDLE',
      position: POS,
      positionQuality: 'RELIABLE',
      lastRequest: null,
    };
    const getStatus = vi.fn(() => status);
    const controller = createRobotController(fakeService({ getStatus }));
    const res = fakeRes();
    controller.getRobotState({ params: params('2') } as unknown as Request, res);
    expect(getStatus).toHaveBeenCalledWith(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(status);
  });

  it('moveRobot AUTHORIZED / DENIED → 200; REJECTED → 409 con el cuerpo de decisión', () => {
    const authorized: PerRobotMoveOutcome = {
      decision: 'AUTHORIZED',
      state: 'IDLE',
      position: POS,
      robotId: 2,
      positionQuality: 'RELIABLE',
    };
    const rejected: PerRobotMoveOutcome = {
      decision: 'REJECTED',
      code: 'BUSY',
      state: 'MOVING',
      position: POS,
      reason: 'busy',
      robotId: 2,
      positionQuality: 'RELIABLE',
    };
    const move = vi.fn();
    const controller = createRobotController(fakeService({ move }));

    move.mockReturnValueOnce(authorized);
    let res = fakeRes();
    controller.moveRobot({ params: params('2'), body: command } as unknown as Request, res);
    expect(move).toHaveBeenCalledWith(2, command);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(authorized);

    move.mockReturnValueOnce(rejected);
    res = fakeRes();
    controller.moveRobot({ params: params('2'), body: command } as unknown as Request, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toBe(rejected);
  });

  it('moveRobot con rechazo de sesión/secuencia → 409 { code, message }', () => {
    const rejection: ServiceResult<LastRequest> = {
      kind: 'rejected',
      code: 'DUPLICATE_EVENT',
      status: 409,
      message: 'Sequence 3 was already processed for this session',
    };
    const controller = createRobotController(fakeService({ move: () => rejection }));
    const res = fakeRes();
    controller.moveRobot({ params: params('1'), body: command } as unknown as Request, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      code: 'DUPLICATE_EVENT',
      message: 'Sequence 3 was already processed for this session',
    });
  });

  it('recoverRobot y positionRobot usan el robotId de la ruta', () => {
    const recover = vi.fn((): ServiceResult<RecoverResponse> => ({
      kind: 'ok',
      value: {
        robotId: 2,
        state: 'IDLE',
        position: POS,
        positionQuality: 'RELIABLE',
        transitioned: false,
      },
    }));
    const setPosition = vi.fn((): ServiceResult<PositionOutcome> => ({
      kind: 'rejected',
      code: 'POSITION_CONFLICT',
      status: 409,
      message: 'conflict',
    }));
    const controller = createRobotController(fakeService({ recover, setPosition }));

    let res = fakeRes();
    controller.recoverRobot({ params: params('2') } as unknown as Request, res);
    expect(recover).toHaveBeenCalledWith(2);
    expect(res.statusCode).toBe(200);

    res = fakeRes();
    const body = { position: POS, quality: 'RELIABLE' as const };
    controller.positionRobot({ params: params('2'), body } as unknown as Request, res);
    expect(setPosition).toHaveBeenCalledWith(2, body);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ code: 'POSITION_CONFLICT', message: 'conflict' });
  });
});
