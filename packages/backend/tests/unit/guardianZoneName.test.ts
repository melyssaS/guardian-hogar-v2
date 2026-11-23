import type { GuardianInput, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';

// Spec 002 — RC-14 (R5.5, design §1): `evaluateMovement` rellena `zoneName` en las denegaciones
// geométricas (la zona implicada); en el resto lo omite. Sigue pura y determinista.

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

const input = (over: Partial<GuardianInput>): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin: { x: 120, y: 90 },
  destination: { x: 450, y: 120 },
  zones: [STAIRS, NURSERY],
  pad: 0,
  ...over,
});

describe('evaluateMovement — zoneName de la denegación geométrica', () => {
  it('destino dentro de Escaleras → zoneName "Escaleras"', () => {
    const d = evaluateMovement(input({ destination: { x: 100, y: 300 } }));
    expect(d).toMatchObject({ code: 'RESTRICTED_ZONE_VIOLATION', zoneName: 'Escaleras' });
  });

  it('destino dentro del Cuarto del bebé → zoneName de esa zona, no de la primera de la lista', () => {
    const d = evaluateMovement(input({ destination: { x: 300, y: 300 } }));
    expect(d).toMatchObject({ code: 'RESTRICTED_ZONE_VIOLATION', zoneName: 'Cuarto del bebé' });
  });

  it('trayectoria que cruza → zoneName de la zona cruzada', () => {
    const d = evaluateMovement(
      input({
        origin: { x: 0, y: 300 },
        destination: { x: 120, y: 300 },
        zones: [NURSERY, STAIRS],
      }),
    );
    expect(d.code === 'RESTRICTED_ZONE_VIOLATION' || d.code === 'TRAJECTORY_CROSSES_ZONE').toBe(
      true,
    );
    expect(d.zoneName).toBe('Escaleras');
  });

  it('origen dentro de una zona → zoneName de esa zona (prioridad global origen > destino)', () => {
    const d = evaluateMovement(
      input({ origin: { x: 100, y: 300 }, destination: { x: 300, y: 300 } }),
    );
    expect(d).toMatchObject({ code: 'ORIGIN_IN_RESTRICTED_ZONE', zoneName: 'Escaleras' });
  });

  it.each([
    ['AUTHORIZED', input({})],
    ['INSUFFICIENT_DATA', input({ positionQuality: 'UNRELIABLE' })],
    ['MISSING_POSITION', input({ positionQuality: 'MISSING' })],
    ['ZONE_DATA_UNAVAILABLE', input({ zones: null })],
    ['SAFE_STOP_ACTIVE', input({ state: 'SAFE_STOP' })],
    ['BUSY', input({ state: 'MOVING' })],
  ] as const)('%s no lleva zoneName (sin zona implicada)', (code, i) => {
    const d = evaluateMovement(i);
    expect(d.code).toBe(code);
    expect(d.zoneName ?? null).toBeNull();
  });

  it('es determinista: la misma entrada da la misma decisión con zoneName', () => {
    const i = input({ destination: { x: 100, y: 300 } });
    expect(evaluateMovement(i)).toEqual(evaluateMovement(i));
  });
});
