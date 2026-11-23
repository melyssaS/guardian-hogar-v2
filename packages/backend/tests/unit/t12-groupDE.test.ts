import type { GuardianInput, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';

// Spec 002 — tarea 19 (T-12 grupos D y E). Prueba que `pad` expande la zona por cada lado
// (expandZone, borde inclusivo) y que la expansión cambia la decisión del vigilante:
//   - Grupo D (5): radio del robot r = 10 → se pasa `pad: 10` (m = 0).
//   - Grupo E (3): margen de seguridad m = 5 → se pasa `pad: 5` (r = 0).
// Regla pura, estado IDLE, posición RELIABLE, una sola zona activa. Sin env, sin BD, sin UI.
// La implementación de `expandZone`/`pointInAABB` es la fuente de verdad: el borde expandido
// pertenece a la zona (DD-003), por eso "exactamente pad de distancia" → denegado.
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

// Escaleras (zona restringida). Caja cruda: x ∈ [29, 189], y ∈ [226, 404].
// Borde superior en y = 226; la banda de expansión queda por encima.
const STAIRS = zone(3, 'Escaleras', 29, 226, 160, 178);
const ORIGIN = { x: 120, y: 90 }; // Sala, muy por encima de la zona (distancia 136 al borde).

const input = (over: Partial<GuardianInput>): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin: ORIGIN,
  destination: { x: 120, y: 50 },
  zones: [STAIRS],
  pad: 0,
  ...over,
});

describe('evaluateMovement — T-12 Grupo D (radio r = 10, pad = 10)', () => {
  // Caja expandida: x ∈ [19, 199], y ∈ [216, 414]. Borde superior expandido en y = 216.
  it('D1: destino exactamente 10 sobre el borde (y=216) → borde expandido inclusivo → RESTRICTED_ZONE_VIOLATION', () => {
    const r = evaluateMovement(input({ pad: 10, destination: { x: 120, y: 216 } }));
    expect(r).toEqual({
      code: 'RESTRICTED_ZONE_VIOLATION',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      zoneName: 'Escaleras',
      reason: expect.any(String),
    });
  });

  it('D2: destino a 9 del borde (y=217) → dentro de la banda de expansión → RESTRICTED_ZONE_VIOLATION', () => {
    const r = evaluateMovement(input({ pad: 10, destination: { x: 120, y: 217 } }));
    expect(r.code).toBe('RESTRICTED_ZONE_VIOLATION');
    expect(r.authorized).toBe(false);
    expect(r.nextState).toBe('SAFE_STOP');
  });

  it('D3 (control): destino a 11 del borde (y=215) → fuera de la expansión → AUTHORIZED', () => {
    const r = evaluateMovement(input({ pad: 10, destination: { x: 120, y: 215 } }));
    expect(r).toEqual({
      code: 'AUTHORIZED',
      authorized: true,
      nextState: 'MOVING',
      collisionType: null,
      reason: expect.any(String),
    });
  });

  it('D4: trayectoria horizontal (y=220) con extremos fuera roza la caja expandida → TRAJECTORY_CROSSES_ZONE', () => {
    // Origen (0,220) y destino (250,220): ambos fuera en x ([19,199]); el segmento cruza la caja.
    const r = evaluateMovement(
      input({ pad: 10, origin: { x: 0, y: 220 }, destination: { x: 250, y: 220 } }),
    );
    expect(r).toEqual({
      code: 'TRAJECTORY_CROSSES_ZONE',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: 'TRAJECTORY_CROSSES_ZONE',
      zoneName: 'Escaleras',
      reason: expect.any(String),
    });
  });

  it('D5: origen en la banda de expansión (y=216) con destino libre → ORIGIN_IN_RESTRICTED_ZONE', () => {
    // El origen, no la zona cruda, cae en el borde expandido: prioridad máxima.
    const r = evaluateMovement(
      input({ pad: 10, origin: { x: 120, y: 216 }, destination: { x: 120, y: 50 } }),
    );
    expect(r).toEqual({
      code: 'ORIGIN_IN_RESTRICTED_ZONE',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: 'ORIGIN_IN_RESTRICTED_ZONE',
      zoneName: 'Escaleras',
      reason: expect.any(String),
    });
  });
});

describe('evaluateMovement — T-12 Grupo E (margen m = 5, pad = 5)', () => {
  // Caja expandida: x ∈ [24, 194], y ∈ [221, 409]. Borde superior expandido en y = 221.
  it('E1: destino a 4 del borde (y=222) → dentro de la banda de margen → RESTRICTED_ZONE_VIOLATION', () => {
    const r = evaluateMovement(input({ pad: 5, destination: { x: 120, y: 222 } }));
    expect(r.code).toBe('RESTRICTED_ZONE_VIOLATION');
    expect(r.authorized).toBe(false);
    expect(r.nextState).toBe('SAFE_STOP');
  });

  it('E2: destino exactamente 5 sobre el borde (y=221) → borde expandido inclusivo → RESTRICTED_ZONE_VIOLATION', () => {
    const r = evaluateMovement(input({ pad: 5, destination: { x: 120, y: 221 } }));
    expect(r).toEqual({
      code: 'RESTRICTED_ZONE_VIOLATION',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      zoneName: 'Escaleras',
      reason: expect.any(String),
    });
  });

  it('E3 (control): destino a 6 del borde (y=220) → fuera de la expansión por margen → AUTHORIZED', () => {
    const r = evaluateMovement(input({ pad: 5, destination: { x: 120, y: 220 } }));
    expect(r).toEqual({
      code: 'AUTHORIZED',
      authorized: true,
      nextState: 'MOVING',
      collisionType: null,
      reason: expect.any(String),
    });
  });
});
