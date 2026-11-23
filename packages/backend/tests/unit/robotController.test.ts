import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createRobotController } from '../../src/controllers/robotController.js';
import type {
  GuardianService,
  MoveOutcome,
  PositionOutcome,
  RecoverOutcome,
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
    getState: vi.fn(),
    move: vi.fn(),
    recover: vi.fn(),
    setPosition: vi.fn(),
    ...overrides,
  };
}

const POS = { x: 10, y: 20 };

describe('robotController — mapeo decisión → HTTP (DD-203)', () => {
  it('getState → 200 con el estado del servicio', () => {
    const state: PositionOutcome = { state: 'IDLE', position: POS, positionQuality: 'RELIABLE' };
    const controller = createRobotController(fakeService({ getState: () => state }));
    const res = fakeRes();
    controller.getState({} as Request, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(state);
  });

  it('move AUTHORIZED → 200', () => {
    const outcome: MoveOutcome = { decision: 'AUTHORIZED', state: 'IDLE', position: POS };
    const move = vi.fn(() => outcome);
    const controller = createRobotController(fakeService({ move }));
    const res = fakeRes();
    controller.move({ body: { destination: POS } } as Request, res);
    expect(move).toHaveBeenCalledWith(POS);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(outcome);
  });

  it('move DENIED → 200 (la denegación es una decisión válida)', () => {
    const outcome: MoveOutcome = {
      decision: 'DENIED',
      code: 'RESTRICTED_ZONE_VIOLATION',
      state: 'SAFE_STOP',
      position: POS,
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      incidentId: 7,
      reason: 'destination inside restricted zone',
    };
    const controller = createRobotController(fakeService({ move: () => outcome }));
    const res = fakeRes();
    controller.move({ body: { destination: POS } } as Request, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(outcome);
  });

  it('move REJECTED → 409 (conflicto de estado)', () => {
    const outcome: MoveOutcome = {
      decision: 'REJECTED',
      code: 'SAFE_STOP_ACTIVE',
      state: 'SAFE_STOP',
      position: POS,
      reason: 'safe stop active',
    };
    const controller = createRobotController(fakeService({ move: () => outcome }));
    const res = fakeRes();
    controller.move({ body: { destination: POS } } as Request, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toBe(outcome);
  });

  it('recover exitoso → 200', () => {
    const outcome: RecoverOutcome = { recovered: true, state: 'IDLE', position: POS };
    const controller = createRobotController(fakeService({ recover: () => outcome }));
    const res = fakeRes();
    controller.recover({} as Request, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(outcome);
  });

  it('recover rechazado → 409', () => {
    const outcome: RecoverOutcome = {
      recovered: false,
      state: 'SAFE_STOP',
      position: POS,
      reason: 'not in a preventive stop',
    };
    const controller = createRobotController(fakeService({ recover: () => outcome }));
    const res = fakeRes();
    controller.recover({} as Request, res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toBe(outcome);
  });

  it('position → 200 con la lectura aportada', () => {
    const outcome: PositionOutcome = {
      state: 'IDLE',
      position: POS,
      positionQuality: 'RELIABLE',
    };
    const setPosition = vi.fn(() => outcome);
    const controller = createRobotController(fakeService({ setPosition }));
    const res = fakeRes();
    const body = { position: POS, quality: 'RELIABLE' as const };
    controller.position({ body } as Request, res);
    expect(setPosition).toHaveBeenCalledWith(body);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(outcome);
  });
});
