import type { GuardianInput, Point, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';

// Spec 002 §7 — Prueba T-12, GRUPO A (9 escenarios). Enfoque: el DESTINO (dentro / fuera /
// borde de una zona activa) decide entre RESTRICTED_ZONE_VIOLATION y AUTHORIZED (R1.3).
// Verifica la regla PURA `evaluateMovement` sin frontend ni base de datos real (R7.4),
// con dobles en memoria de zonas y `pad = 0` para que la geometría de borde sea exacta.
//
// Para AISLAR el destino como factor decisivo:
//   - el ORIGEN está FUERA de toda zona (si estuviera dentro ganaría ORIGIN_IN_RESTRICTED_ZONE),
//   - el estado es IDLE y la calidad es RELIABLE (no se dispara ninguna rama previa),
//   - hay UNA sola zona activa.
// Borde INCLUSIVO (DD-003, `pointInAABB`): un punto sobre el borde cuenta como DENTRO.

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

// Zona única activa. Con pad 0 su AABB inclusiva es x ∈ [29, 189], y ∈ [226, 404].
const STAIRS = zone(3, 'Escaleras', 29, 226, 160, 178);
const MIN_X = 29;
const MAX_X = 29 + 160; // 189
const MIN_Y = 226;
const MAX_Y = 226 + 178; // 404

// Origen en la Sala: y = 90 < 226, claramente fuera de la zona (y de toda otra).
const ORIGIN: Point = { x: 120, y: 90 };

const input = (destination: Point): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin: ORIGIN,
  destination,
  zones: [STAIRS],
  pad: 0,
});

const expectViolation = (destination: Point): void => {
  expect(evaluateMovement(input(destination))).toEqual({
    code: 'RESTRICTED_ZONE_VIOLATION',
    authorized: false,
    nextState: 'SAFE_STOP',
    collisionType: 'RESTRICTED_ZONE_VIOLATION',
    reason: expect.any(String),
  });
};

const expectAuthorized = (destination: Point): void => {
  expect(evaluateMovement(input(destination))).toEqual({
    code: 'AUTHORIZED',
    authorized: true,
    nextState: 'MOVING',
    collisionType: null,
    reason: expect.any(String),
  });
};

describe('T-12 Grupo A — destino dentro/fuera/borde (R1.3, R7.4)', () => {
  // --- DENTRO ---
  it('A1: destino claramente dentro (centro de la zona) → RESTRICTED_ZONE_VIOLATION', () => {
    expectViolation({ x: 109, y: 315 });
  });

  it('A8: destino apenas dentro por un epsilon (justo bajo el borde superior) → RESTRICTED_ZONE_VIOLATION', () => {
    expectViolation({ x: 100, y: MIN_Y + 0.001 });
  });

  // --- BORDE (inclusivo: el borde pertenece a la zona, DD-003) ---
  it('A3: destino sobre el borde izquierdo (x = minX) → RESTRICTED_ZONE_VIOLATION', () => {
    expectViolation({ x: MIN_X, y: 315 });
  });

  it('A4: destino sobre el borde derecho (x = maxX) → RESTRICTED_ZONE_VIOLATION', () => {
    expectViolation({ x: MAX_X, y: 315 });
  });

  it('A5: destino sobre el borde superior (y = minY) → RESTRICTED_ZONE_VIOLATION', () => {
    expectViolation({ x: 109, y: MIN_Y });
  });

  it('A6: destino sobre el borde inferior (y = maxY) → RESTRICTED_ZONE_VIOLATION', () => {
    expectViolation({ x: 109, y: MAX_Y });
  });

  it('A7: destino en una esquina (maxX, maxY) → RESTRICTED_ZONE_VIOLATION', () => {
    expectViolation({ x: MAX_X, y: MAX_Y });
  });

  // --- FUERA ---
  it('A2: destino claramente fuera de toda zona → AUTHORIZED', () => {
    expectAuthorized({ x: 450, y: 120 });
  });

  it('A9: destino apenas fuera por un epsilon (justo sobre el borde superior) → AUTHORIZED', () => {
    expectAuthorized({ x: 100, y: MIN_Y - 0.001 });
  });
});
