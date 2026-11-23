import type { GuardianInput, Point, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';

// Spec 002 — Tarea 17. Suite T-12 Grupo B (5 escenarios): rama de TRAYECTORIA.
// Requisitos 1.4 y 7.4. Regla pura `evaluateMovement`, zonas en memoria, sin BD ni frontend.
//
// Una sola zona activa (Escaleras) con `pad = 0` para aislar la rama de trayectoria:
//   - AABB de Escaleras con pad 0 → minX=29, maxX=189, minY=226, maxY=404.
//   - En TODOS los casos el origen y el destino quedan FUERA de la caja, de modo que las
//     ramas de origen/destino no disparan y se evalúa solo el cruce del segmento.
//   - `segmentIntersectsAABB` (Liang-Barsky, DD-002) trata el borde como inclusivo: un segmento
//     tangente que solo toca una esquina cuenta como intersección (t0 === t1 en la esquina).

const STAIRS: Zone = {
  id: 3,
  name: 'Escaleras',
  x: 29,
  y: 226,
  width: 160,
  height: 178,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const input = (origin: Point, destination: Point): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin,
  destination,
  zones: [STAIRS],
  pad: 0,
});

const crosses = {
  code: 'TRAJECTORY_CROSSES_ZONE',
  authorized: false,
  nextState: 'SAFE_STOP',
  collisionType: 'TRAJECTORY_CROSSES_ZONE',
  reason: expect.any(String),
};

const authorized = {
  code: 'AUTHORIZED',
  authorized: true,
  nextState: 'MOVING',
  collisionType: null,
  reason: expect.any(String),
};

describe('T-12 Grupo B — trayectoria cruza/tangente/no cruza (R1.4, R7.4)', () => {
  // 1. Cruce claro horizontal: y=300 está dentro [226,404]; el segmento barre x de 0 a 300,
  //    atravesando [29,189]. Extremos fuera: x=0 < 29 y x=300 > 189.
  it('B1: trayectoria horizontal atraviesa la zona → TRAJECTORY_CROSSES_ZONE', () => {
    expect(evaluateMovement(input({ x: 0, y: 300 }, { x: 300, y: 300 }))).toEqual(crosses);
  });

  // 2. Cruce claro diagonal: de (0,180) a (220,420). Entra por el borde superior en (~42,226)
  //    y sale por el derecho en (189,~386). Extremos fuera: (0,180) y<226; (220,420) x>189, y>404.
  it('B2: trayectoria diagonal atraviesa la zona → TRAJECTORY_CROSSES_ZONE', () => {
    expect(evaluateMovement(input({ x: 0, y: 180 }, { x: 220, y: 420 }))).toEqual(crosses);
  });

  // 3. Tangente a una esquina: de (179,216) a (199,236) el segmento pasa EXACTAMENTE por la
  //    esquina superior derecha (189,226). Por el borde inclusivo de Liang-Barsky (t0 === t1 en
  //    la esquina) cuenta como intersección. Extremos fuera: (179,216) y<226; (199,236) x>189.
  it('B3: trayectoria tangente que roza una esquina → TRAJECTORY_CROSSES_ZONE (borde inclusivo)', () => {
    expect(evaluateMovement(input({ x: 179, y: 216 }, { x: 199, y: 236 }))).toEqual(crosses);
  });

  // 4. No cruza — ambos extremos del mismo lado: y=100 queda por encima de la zona (minY=226),
  //    el segmento horizontal nunca entra en la caja.
  it('B4: trayectoria por encima de la zona, no cruza → AUTHORIZED', () => {
    expect(evaluateMovement(input({ x: 0, y: 100 }, { x: 300, y: 100 }))).toEqual(authorized);
  });

  // 5. No cruza — bien despejada: segmento entero abajo-derecha de la zona, lejos de la caja.
  it('B5: trayectoria despejada lejos de la zona, no cruza → AUTHORIZED', () => {
    expect(evaluateMovement(input({ x: 500, y: 500 }, { x: 600, y: 600 }))).toEqual(authorized);
  });
});
