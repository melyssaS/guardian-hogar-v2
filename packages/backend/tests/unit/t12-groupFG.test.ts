import type { GuardianInput, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';

// Spec 002 — T-12 grupos F y G (tarea 20). Verifica que la calidad de datos y el estado del
// repositorio de zonas se evalúan ANTES que la geometría (orden estricto §2 / Property 2:
// datos antes que geometría). En cada escenario el estado es IDLE (admite movimiento) y el
// destino es geométricamente inválido (dentro de Escaleras): si la geometría se evaluara, la
// decisión sería RESTRICTED_ZONE_VIOLATION. Que no lo sea prueba el cortocircuito por datos.
// Requisitos: 2.2 (UNRELIABLE → INSUFFICIENT_DATA), 2.3 (MISSING → MISSING_POSITION),
// 2.4 (repo caído → ZONE_DATA_UNAVAILABLE), 7.4 (ejecutable sin frontend ni BD real).
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
const ORIGIN = { x: 120, y: 90 }; // Sala, fuera de toda zona

// Destino dentro de Escaleras: sería RESTRICTED_ZONE_VIOLATION si la geometría se evaluara.
const DESTINATION_IN_ZONE = { x: 100, y: 300 };

const input = (over: Partial<GuardianInput>): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin: ORIGIN,
  destination: DESTINATION_IN_ZONE,
  zones: ZONES,
  pad: 0,
  ...over,
});

describe('T-12 Grupo F — calidad de posición antes que geometría (R2.2, R2.3, 7.4)', () => {
  it('F.1 UNRELIABLE (destino en zona) → INSUFFICIENT_DATA, DEGRADED, sin geometría', () => {
    const r = evaluateMovement(input({ positionQuality: 'UNRELIABLE' }));
    expect(r).toEqual({
      code: 'INSUFFICIENT_DATA',
      authorized: false,
      nextState: 'DEGRADED',
      collisionType: null,
      reason: expect.any(String),
    });
    // Prueba data-before-geometry: el destino dentro de la zona NO produjo violación geométrica.
    expect(r.code).not.toBe('RESTRICTED_ZONE_VIOLATION');
  });

  it('F.2 MISSING (destino en zona) → MISSING_POSITION, DEGRADED, sin geometría', () => {
    const r = evaluateMovement(input({ positionQuality: 'MISSING' }));
    expect(r).toEqual({
      code: 'MISSING_POSITION',
      authorized: false,
      nextState: 'DEGRADED',
      collisionType: null,
      reason: expect.any(String),
    });
    expect(r.code).not.toBe('RESTRICTED_ZONE_VIOLATION');
  });
});

describe('T-12 Grupo G — repositorio de zonas caído antes que geometría (R2.4, 7.4)', () => {
  it('G.1 zones === null, RELIABLE (destino en zona) → ZONE_DATA_UNAVAILABLE, SAFE_STOP, sin geometría', () => {
    const r = evaluateMovement(input({ zones: null, positionQuality: 'RELIABLE' }));
    expect(r).toEqual({
      code: 'ZONE_DATA_UNAVAILABLE',
      authorized: false,
      nextState: 'SAFE_STOP',
      collisionType: null,
      reason: expect.any(String),
    });
    // Sin zonas no hay geometría posible; la decisión proviene del dato de repositorio caído.
    expect(r.code).not.toBe('RESTRICTED_ZONE_VIOLATION');
  });
});
