import type { GuardianInput, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';

// T-12 Grupo C (3 escenarios) — sin zonas activas → siempre AUTHORIZED.
// Requisitos: 1.5 (sin condición de denegación → AUTHORIZED), 7.4 (T-12 sin frontend ni BD real).
//
// Garantía de este grupo: cuando el conjunto de zonas ACTIVAS está vacío, la geometría nunca
// puede denegar, de modo que todo movimiento (con estado IDLE y posición RELIABLE) se autoriza.
// Regla pura `evaluateMovement`: zonas en memoria, sin persistencia.

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

// Escaleras (zona restringida de la línea base). Origen en la Sala, fuera de toda zona.
const STAIRS = zone(3, 'Escaleras', 29, 226, 160, 178);
const ORIGIN = { x: 120, y: 90 };

const input = (over: Partial<GuardianInput>): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin: ORIGIN,
  destination: { x: 450, y: 120 },
  zones: [],
  pad: 0,
  ...over,
});

describe('evaluateMovement — T-12 Grupo C: sin zonas activas → AUTHORIZED (R1.5, R7.4)', () => {
  it('C1: lista de zonas vacía → cualquier destino → AUTHORIZED', () => {
    expect(evaluateMovement(input({ zones: [], destination: { x: 540, y: 300 } }))).toEqual({
      code: 'AUTHORIZED',
      authorized: true,
      nextState: 'MOVING',
      collisionType: null,
      reason: expect.any(String),
    });
  });

  it('C2: única zona inactiva cuyo área contiene el destino → ignorada → AUTHORIZED', () => {
    // Destino DENTRO de Escaleras: denegaría si la zona estuviera activa, pero está inactiva.
    const inactiveStairs: Zone = { ...STAIRS, active: false };
    const r = evaluateMovement(input({ zones: [inactiveStairs], destination: { x: 100, y: 300 } }));
    expect(r).toEqual({
      code: 'AUTHORIZED',
      authorized: true,
      nextState: 'MOVING',
      collisionType: null,
      reason: expect.any(String),
    });
  });

  it('C3: trayectoria que cruzaría una zona, pero esa zona es inactiva → AUTHORIZED', () => {
    // Origen (Sala) y destino (bajo las Escaleras) fuera de la zona; el segmento atraviesa
    // el rectángulo de Escaleras. Con la zona inactiva no hay zonas activas → AUTHORIZED.
    const inactiveStairs: Zone = { ...STAIRS, active: false };
    const r = evaluateMovement(input({ zones: [inactiveStairs], destination: { x: 110, y: 600 } }));
    expect(r).toEqual({
      code: 'AUTHORIZED',
      authorized: true,
      nextState: 'MOVING',
      collisionType: null,
      reason: expect.any(String),
    });
  });
});
