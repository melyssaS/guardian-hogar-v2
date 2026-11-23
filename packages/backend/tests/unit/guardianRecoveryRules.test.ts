import {
  ruleForDecision,
  type GuardianInput,
  type IncidentCode,
  type RuleId,
  type Zone,
} from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import {
  evaluateMovement,
  evaluateRecovery,
  evaluateStartPosition,
} from '../../src/rules/guardian.js';

// Spec 002 — RC-2 (ruleForDecision con IncidentCode) y RC-3 (evaluateRecovery, evaluateStartPosition)

const zone = (over: Partial<Zone> = {}): Zone => ({
  id: 1,
  name: 'Escaleras',
  x: 100,
  y: 100,
  width: 50,
  height: 50,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  ...over,
});

describe('ruleForDecision aplicado a los códigos del vigilante (RC-2)', () => {
  const base: GuardianInput = {
    state: 'IDLE',
    positionQuality: 'RELIABLE',
    origin: { x: 10, y: 10 },
    destination: { x: 20, y: 20 },
    zones: [],
    pad: 0,
  };
  const cases: ReadonlyArray<readonly [string, GuardianInput, RuleId | null]> = [
    ['AUTHORIZED', base, null],
    ['SAFE_STOP_ACTIVE', { ...base, state: 'SAFE_STOP' }, null],
    ['BUSY', { ...base, state: 'MOVING' }, null],
    ['INSUFFICIENT_DATA', { ...base, positionQuality: 'UNRELIABLE' }, 'R-SIGNAL-01'],
    ['MISSING_POSITION', { ...base, positionQuality: 'MISSING' }, 'R-SIGNAL-01'],
    ['ZONE_DATA_UNAVAILABLE', { ...base, zones: null }, 'R-DATA-01'],
    [
      'RESTRICTED_ZONE_VIOLATION',
      { ...base, destination: { x: 120, y: 120 }, zones: [zone()] },
      'R-ZONA-01',
    ],
    [
      'ORIGIN_IN_RESTRICTED_ZONE',
      { ...base, origin: { x: 120, y: 120 }, zones: [zone()] },
      'R-ZONA-01',
    ],
    [
      'TRAJECTORY_CROSSES_ZONE',
      { ...base, origin: { x: 10, y: 125 }, destination: { x: 300, y: 125 }, zones: [zone()] },
      'R-ZONA-01',
    ],
  ];
  it.each(cases)('%s → regla esperada', (code, input, rule) => {
    const decision = evaluateMovement(input);
    expect(decision.code).toBe(code);
    expect(ruleForDecision(decision.code)).toBe(rule);
  });

  it('POSITION_QUALITY_LOST → R-SIGNAL-01 (incidente de pérdida de señal)', () => {
    const code: IncidentCode = 'POSITION_QUALITY_LOST';
    expect(ruleForDecision(code)).toBe('R-SIGNAL-01');
  });
});

describe('evaluateRecovery (RC-3, R4.4)', () => {
  const at = { x: 10, y: 10 };

  it('permite con datos confiables y posición fuera de toda zona', () => {
    expect(
      evaluateRecovery({ positionQuality: 'RELIABLE', position: at, zones: [zone()] }),
    ).toEqual({ allowed: true });
  });

  it.each(['UNRELIABLE', 'MISSING'] as const)('%s → UNRELIABLE_DATA', (positionQuality) => {
    expect(evaluateRecovery({ positionQuality, position: at, zones: [zone()] })).toEqual({
      allowed: false,
      cause: 'UNRELIABLE_DATA',
    });
  });

  it('zonas no disponibles → ZONE_DATA_UNAVAILABLE', () => {
    expect(evaluateRecovery({ positionQuality: 'RELIABLE', position: at, zones: null })).toEqual({
      allowed: false,
      cause: 'ZONE_DATA_UNAVAILABLE',
    });
  });

  it('posición dentro de zona activa → UNSAFE_POSITION', () => {
    expect(
      evaluateRecovery({
        positionQuality: 'RELIABLE',
        position: { x: 120, y: 120 },
        zones: [zone()],
      }),
    ).toEqual({ allowed: false, cause: 'UNSAFE_POSITION' });
  });

  it('orden: UNRELIABLE_DATA antes que ZONE_DATA_UNAVAILABLE', () => {
    expect(evaluateRecovery({ positionQuality: 'MISSING', position: at, zones: null })).toEqual({
      allowed: false,
      cause: 'UNRELIABLE_DATA',
    });
  });

  it('la expansión por pad cuenta: fuera del borde pero dentro del pad → UNSAFE_POSITION', () => {
    // Zona en x in [100,150]: x = 95 queda fuera con pad 0 y dentro con pad 10.
    const near = { x: 95, y: 120 };
    expect(
      evaluateRecovery({ positionQuality: 'RELIABLE', position: near, zones: [zone()], pad: 10 }),
    ).toEqual({ allowed: false, cause: 'UNSAFE_POSITION' });
    expect(
      evaluateRecovery({ positionQuality: 'RELIABLE', position: near, zones: [zone()], pad: 0 }),
    ).toEqual({ allowed: true });
  });

  it('ignora zonas inactivas', () => {
    expect(
      evaluateRecovery({
        positionQuality: 'RELIABLE',
        position: { x: 120, y: 120 },
        zones: [zone({ active: false })],
      }),
    ).toEqual({ allowed: true });
  });
});

describe('evaluateStartPosition (RC-3, R12.2)', () => {
  it('permite una posición fuera de toda zona activa', () => {
    expect(evaluateStartPosition({ position: { x: 10, y: 10 }, zones: [zone()] })).toEqual({
      allowed: true,
    });
  });

  it('rechaza dentro de zona activa expandida con ROBOT_START_IN_RESTRICTED_ZONE', () => {
    expect(evaluateStartPosition({ position: { x: 120, y: 120 }, zones: [zone()] })).toEqual({
      allowed: false,
      reason: 'ROBOT_START_IN_RESTRICTED_ZONE',
    });
    expect(
      evaluateStartPosition({ position: { x: 95, y: 120 }, zones: [zone()], pad: 10 }),
    ).toEqual({ allowed: false, reason: 'ROBOT_START_IN_RESTRICTED_ZONE' });
    expect(evaluateStartPosition({ position: { x: 95, y: 120 }, zones: [zone()], pad: 0 })).toEqual(
      {
        allowed: true,
      },
    );
  });

  it('zonas no disponibles → rechazo con razón ZONE_DATA_UNAVAILABLE', () => {
    expect(evaluateStartPosition({ position: { x: 10, y: 10 }, zones: null })).toEqual({
      allowed: false,
      reason: 'ZONE_DATA_UNAVAILABLE',
    });
  });

  it('ignora zonas inactivas', () => {
    expect(
      evaluateStartPosition({ position: { x: 120, y: 120 }, zones: [zone({ active: false })] }),
    ).toEqual({ allowed: true });
  });
});
