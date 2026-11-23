import type { GuardianDecision, PositionQuality, RobotStateName } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { applyDecision, canTransition, completeMove } from '../../src/rules/stateMachine.js';

// Spec 002 — tarea 3 (TDD). Máquina de estados: tabla de transiciones (§2.2) y
// prohibiciones P-1 (SAFE_STOP/DEGRADED → MOVING) y P-2 (datos no confiables → MOVING).

const RELIABLE: PositionQuality = 'RELIABLE';
const UNRELIABLE: PositionQuality = 'UNRELIABLE';
const MISSING: PositionQuality = 'MISSING';

const ALL_STATES: RobotStateName[] = ['IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING'];

// Transiciones permitidas de requirements §2.2 (sin contar la celda prohibida P-1).
// [from, to]
const ALLOWED: ReadonlyArray<readonly [RobotStateName, RobotStateName]> = [
  ['IDLE', 'MOVING'], // mueve + AUTHORIZED
  ['IDLE', 'SAFE_STOP'], // denegación geométrica
  ['IDLE', 'DEGRADED'], // datos insuficientes
  ['MOVING', 'IDLE'], // movimiento completado
  ['MOVING', 'SAFE_STOP'], // denegación / arranque MOVING persistido
  ['MOVING', 'DEGRADED'], // datos insuficientes
  ['SAFE_STOP', 'SAFE_STOP'], // absorbe denegaciones / datos
  ['SAFE_STOP', 'RECOVERING'], // recover válido
  ['DEGRADED', 'SAFE_STOP'], // denegación
  ['DEGRADED', 'DEGRADED'], // datos insuficientes
  ['DEGRADED', 'RECOVERING'], // recover válido
  ['RECOVERING', 'SAFE_STOP'], // denegación
  ['RECOVERING', 'DEGRADED'], // datos insuficientes
  ['RECOVERING', 'IDLE'], // recover completado
];

const isAllowed = (from: RobotStateName, to: RobotStateName): boolean =>
  ALLOWED.some(([f, t]) => f === from && t === to);

const decision = (over: Partial<GuardianDecision>): GuardianDecision => ({
  code: 'AUTHORIZED',
  authorized: true,
  nextState: 'MOVING',
  collisionType: null,
  reason: 'test',
  ...over,
});

describe('stateMachine — canTransition (tabla §2.2)', () => {
  describe('cada transición permitida de la tabla devuelve true (posición confiable)', () => {
    it.each(ALLOWED)('%s → %s es permitida', (from, to) => {
      expect(canTransition(from, to, RELIABLE)).toBe(true);
    });
  });

  describe('las transiciones fuera de la tabla devuelven false (posición confiable)', () => {
    const notAllowed = ALL_STATES.flatMap((from) =>
      ALL_STATES.filter((to) => !isAllowed(from, to)).map((to) => [from, to] as const),
    );
    it.each(notAllowed)('%s → %s no es permitida', (from, to) => {
      expect(canTransition(from, to, RELIABLE)).toBe(false);
    });
  });

  describe('P-1: SAFE_STOP y DEGRADED → MOVING están prohibidos', () => {
    it('SAFE_STOP → MOVING es false incluso con posición confiable', () => {
      expect(canTransition('SAFE_STOP', 'MOVING', RELIABLE)).toBe(false);
    });
    it('DEGRADED → MOVING es false incluso con posición confiable', () => {
      expect(canTransition('DEGRADED', 'MOVING', RELIABLE)).toBe(false);
    });
  });

  describe('P-2: cualquier estado → MOVING con datos no confiables está prohibido', () => {
    it.each(ALL_STATES)('%s → MOVING es false con UNRELIABLE', (from) => {
      expect(canTransition(from, 'MOVING', UNRELIABLE)).toBe(false);
    });
    it.each(ALL_STATES)('%s → MOVING es false con MISSING', (from) => {
      expect(canTransition(from, 'MOVING', MISSING)).toBe(false);
    });
    it('IDLE → MOVING sigue permitido con RELIABLE', () => {
      expect(canTransition('IDLE', 'MOVING', RELIABLE)).toBe(true);
    });
  });
});

describe('stateMachine — completeMove (MOVING → IDLE)', () => {
  it('MOVING se completa de inmediato a IDLE', () => {
    expect(completeMove('MOVING')).toBe('IDLE');
  });

  it.each(ALL_STATES.filter((s) => s !== 'MOVING'))(
    'un estado no-MOVING (%s) se devuelve sin cambios',
    (state) => {
      expect(completeMove(state)).toBe(state);
    },
  );
});

describe('stateMachine — applyDecision', () => {
  it('una denegación geométrica desde IDLE lleva a SAFE_STOP', () => {
    const d = decision({
      code: 'RESTRICTED_ZONE_VIOLATION',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
    });
    expect(applyDecision('IDLE', d)).toBe('SAFE_STOP');
  });

  it('datos insuficientes desde IDLE llevan a DEGRADED', () => {
    const d = decision({
      code: 'INSUFFICIENT_DATA',
      authorized: false,
      nextState: 'DEGRADED',
      collisionType: null,
    });
    expect(applyDecision('IDLE', d)).toBe('DEGRADED');
  });

  it('un AUTHORIZED desde IDLE pasa a MOVING (estado transitorio)', () => {
    const d = decision({ nextState: 'MOVING' });
    expect(applyDecision('IDLE', d)).toBe('MOVING');
  });

  it('es pura: no muta la decisión de entrada', () => {
    const d = decision({ nextState: 'SAFE_STOP', authorized: false, code: 'SAFE_STOP_ACTIVE' });
    const snapshot = structuredClone(d);
    applyDecision('IDLE', d);
    expect(d).toEqual(snapshot);
  });
});
