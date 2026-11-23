import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  incidentIdParamSchema,
  incidentListQuerySchema,
  robotIdParamSchema,
} from '../src/index.js';
import type {
  GuardianDecision,
  Incident,
  IncidentCode,
  IncidentDetail,
  LastRequest,
  RecoverResponse,
  RecoveryRejectionCause,
  RejectionCode,
  RobotId,
  RobotStatus,
  RuleId,
  ServiceResult,
  TransitionCause,
  Zone,
} from '../src/index.js';

// Spec 002 — RC-1b (R5.6, R5.7, R5.10, R9, R12.3)
describe('robotIdParamSchema', () => {
  it('convierte robotId a entero positivo', () => {
    expect(robotIdParamSchema.parse({ robotId: '2' })).toEqual({ robotId: 2 });
  });
  it('rechaza 0, negativos, decimales y no numéricos', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '']) {
      expect(robotIdParamSchema.safeParse({ robotId: bad }).success, bad).toBe(false);
    }
  });
});

describe('incidentIdParamSchema', () => {
  it('convierte id a entero positivo', () => {
    expect(incidentIdParamSchema.parse({ id: '7' })).toEqual({ id: 7 });
  });
  it('rechaza valores inválidos', () => {
    for (const bad of ['0', '-4', '2.2', 'x']) {
      expect(incidentIdParamSchema.safeParse({ id: bad }).success, bad).toBe(false);
    }
  });
});

describe('incidentListQuerySchema', () => {
  it('robotId es opcional', () => {
    expect(incidentListQuerySchema.parse({})).toEqual({});
  });
  it('convierte robotId a entero positivo', () => {
    expect(incidentListQuerySchema.parse({ robotId: '1' })).toEqual({ robotId: 1 });
  });
  it('rechaza robotId inválido', () => {
    for (const bad of ['0', '-1', 'a', '1.5']) {
      expect(incidentListQuerySchema.safeParse({ robotId: bad }).success, bad).toBe(false);
    }
  });
});

describe('tipos del vigilante por robot', () => {
  it('RobotStatus incluye lastRequest y RecoverResponse lo omite', () => {
    expectTypeOf<RobotStatus['lastRequest']>().toEqualTypeOf<LastRequest | null>();
    expectTypeOf<RobotStatus['robotId']>().toEqualTypeOf<RobotId>();
    expectTypeOf<RecoverResponse>().not.toHaveProperty('lastRequest');
    expectTypeOf<RecoverResponse['transitioned']>().toEqualTypeOf<boolean>();
  });

  it('Incident usa IncidentCode, RuleId y zoneName', () => {
    expectTypeOf<Incident['decisionCode']>().toEqualTypeOf<IncidentCode>();
    expectTypeOf<Incident['rule']>().toEqualTypeOf<RuleId>();
    expectTypeOf<Incident['zoneName']>().toEqualTypeOf<string | null>();
    expectTypeOf<IncidentDetail['zonesSnapshot']>().toEqualTypeOf<Zone[]>();
  });

  it('GuardianDecision admite zoneName opcional', () => {
    expectTypeOf<GuardianDecision['zoneName']>().toEqualTypeOf<string | null | undefined>();
  });

  it('RejectionCode incluye ROBOT_START_NOT_VERIFIABLE y TransitionCause MIGRATION_BASELINE', () => {
    expectTypeOf<'ROBOT_START_NOT_VERIFIABLE'>().toExtend<RejectionCode>();
    expectTypeOf<'MIGRATION_BASELINE'>().toExtend<TransitionCause>();
    expectTypeOf<'UNSAFE_POSITION'>().toExtend<RecoveryRejectionCause>();
  });

  it('ServiceResult discrimina ok y rejected', () => {
    const ok: ServiceResult<number> = { kind: 'ok', value: 1 };
    const rejected: ServiceResult<number> = {
      kind: 'rejected',
      code: 'BUSY',
      status: 409,
      message: 'ocupado',
    };
    expect(ok.kind).toBe('ok');
    expect(rejected.kind === 'rejected' && rejected.status).toBe(409);
  });
});
