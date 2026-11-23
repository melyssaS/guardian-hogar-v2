import type { GuardianInput, PositionQuality, RobotStateName, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';
import { canTransition } from '../../src/rules/stateMachine.js';

// Spec 002 — tarea 21 (VERIFICAR). Conjunto enfocado que asserta explícitamente las
// invariantes de seguridad nombradas (design.md Correctness Property 4):
//   - P-1 (R3.4): SAFE_STOP/DEGRADED → MOVING prohibido; única salida vía RECOVERING → IDLE.
//   - P-2 (R3.5): positionQuality distinto de RELIABLE → ninguna transición a MOVING.
//   - R1.2: origen dentro de zona activa → ORIGIN_IN_RESTRICTED_ZONE (prioridad sobre destino).
// Esta suite es independiente de stateMachine.test.ts y guardian.test.ts (no los sustituye).

const RELIABLE: PositionQuality = 'RELIABLE';
const UNRELIABLE: PositionQuality = 'UNRELIABLE';
const MISSING: PositionQuality = 'MISSING';

// ---------------------------------------------------------------------------
// P-1 (R3.4): SAFE_STOP y DEGRADED no pueden ir directo a MOVING.
// ---------------------------------------------------------------------------
describe('Property 4 / P-1 (R3.4): SAFE_STOP y DEGRADED → MOVING prohibidos', () => {
  it('SAFE_STOP → MOVING es false aun con posición RELIABLE', () => {
    expect(canTransition('SAFE_STOP', 'MOVING', RELIABLE)).toBe(false);
  });

  it('DEGRADED → MOVING es false aun con posición RELIABLE', () => {
    expect(canTransition('DEGRADED', 'MOVING', RELIABLE)).toBe(false);
  });

  it('la única salida hacia MOVING es vía RECOVERING → IDLE (no directa desde SAFE_STOP)', () => {
    // Camino legal de recuperación (requirements §2.2): SAFE_STOP → RECOVERING → IDLE → MOVING.
    expect(canTransition('SAFE_STOP', 'RECOVERING', RELIABLE)).toBe(true);
    expect(canTransition('RECOVERING', 'IDLE', RELIABLE)).toBe(true);
    expect(canTransition('IDLE', 'MOVING', RELIABLE)).toBe(true);
    // Y el atajo prohibido permanece cerrado en cualquier punto de la parada.
    expect(canTransition('SAFE_STOP', 'MOVING', RELIABLE)).toBe(false);
    expect(canTransition('DEGRADED', 'MOVING', RELIABLE)).toBe(false);
  });

  it('DEGRADED también sale solo vía RECOVERING, nunca directo a MOVING', () => {
    expect(canTransition('DEGRADED', 'RECOVERING', RELIABLE)).toBe(true);
    expect(canTransition('DEGRADED', 'MOVING', RELIABLE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P-2 (R3.5): datos no confiables → ninguna transición a MOVING.
// ---------------------------------------------------------------------------
describe('Property 4 / P-2 (R3.5): datos no confiables bloquean toda transición a MOVING', () => {
  // Estados desde los que la tabla §2.2 sí permitiría ir a MOVING con datos confiables.
  const MOVABLE_ORIGINS: RobotStateName[] = ['IDLE', 'RECOVERING'];

  it.each(MOVABLE_ORIGINS)('%s → MOVING es false con UNRELIABLE', (from) => {
    expect(canTransition(from, 'MOVING', UNRELIABLE)).toBe(false);
  });

  it.each(MOVABLE_ORIGINS)('%s → MOVING es false con MISSING', (from) => {
    expect(canTransition(from, 'MOVING', MISSING)).toBe(false);
  });

  it('control: IDLE → MOVING sí es true con RELIABLE (el único caso permitido)', () => {
    expect(canTransition('IDLE', 'MOVING', RELIABLE)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R1.2: origen dentro de zona activa → ORIGIN_IN_RESTRICTED_ZONE (prioridad sobre destino).
// Zonas del prototipo con pad 0 y borde inclusivo (DD-003):
//   Escaleras:       x∈[29,189],  y∈[226,404]
//   Cuarto del bebé: x∈[206,393], y∈[226,404]
// ---------------------------------------------------------------------------
const zone = (id: number, name: string, x: number, y: number, w: number, h: number): Zone => ({
  id,
  name,
  x,
  y,
  width: w,
  height: h,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
});

const STAIRS = zone(3, 'Escaleras', 29, 226, 160, 178);
const NURSERY = zone(4, 'Cuarto del bebé', 206, 226, 187, 178);
const ZONES = [STAIRS, NURSERY];

const input = (over: Partial<GuardianInput>): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin: { x: 120, y: 90 }, // Sala, fuera de toda zona
  destination: { x: 450, y: 120 },
  zones: ZONES,
  pad: 0,
  ...over,
});

describe('R1.2: origen en zona activa → ORIGIN_IN_RESTRICTED_ZONE', () => {
  it('origen dentro de Cuarto del bebé y destino libre → ORIGIN_IN_RESTRICTED_ZONE, SAFE_STOP', () => {
    // Origen (300,300) ∈ Cuarto del bebé; destino (450,120) fuera de toda zona.
    const r = evaluateMovement(
      input({ origin: { x: 300, y: 300 }, destination: { x: 450, y: 120 } }),
    );
    expect(r).toEqual({
      code: 'ORIGIN_IN_RESTRICTED_ZONE',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: 'ORIGIN_IN_RESTRICTED_ZONE',
      reason: expect.any(String),
    });
  });

  it('origen en una zona Y destino en OTRA zona → ORIGIN gana (prioridad origen, R1.7)', () => {
    // Origen (300,300) ∈ Cuarto del bebé; destino (100,300) ∈ Escaleras.
    // El origen tiene prioridad máxima sobre destino y trayectoria.
    const r = evaluateMovement(
      input({ origin: { x: 300, y: 300 }, destination: { x: 100, y: 300 } }),
    );
    expect(r).toEqual({
      code: 'ORIGIN_IN_RESTRICTED_ZONE',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: 'ORIGIN_IN_RESTRICTED_ZONE',
      reason: expect.any(String),
    });
  });

  it('origen en el borde inclusivo de la zona (DD-003) también cuenta como dentro', () => {
    // Esquina (29,226) ∈ Escaleras por borde inclusivo; destino libre.
    const r = evaluateMovement(
      input({ origin: { x: 29, y: 226 }, destination: { x: 450, y: 120 } }),
    );
    expect(r.code).toBe('ORIGIN_IN_RESTRICTED_ZONE');
    expect(r.collisionType).toBe('ORIGIN_IN_RESTRICTED_ZONE');
    expect(r.authorized).toBe(false);
    expect(r.nextState).toBe('SAFE_STOP');
  });
});
