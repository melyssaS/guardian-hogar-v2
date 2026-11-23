import { describe, expect, it } from 'vitest';
import { moveSchema, positionSchema } from '../src/index.js';

// Spec 002 — R7.1 (validación Zod), R8.1 (lectura de posición)
describe('esquemas Zod del robot', () => {
  it('moveSchema exige destination con forma de punto', () => {
    expect(moveSchema.parse({ destination: { x: 250, y: 175 } })).toEqual({
      destination: { x: 250, y: 175 },
    });
    expect(moveSchema.safeParse({}).success).toBe(false);
    expect(moveSchema.safeParse({ destination: { x: 'a', y: 2 } }).success).toBe(false);
  });

  it('positionSchema acepta una lectura RELIABLE válida', () => {
    expect(positionSchema.parse({ position: { x: 120, y: 90 }, quality: 'RELIABLE' })).toEqual({
      position: { x: 120, y: 90 },
      quality: 'RELIABLE',
    });
  });

  it('positionSchema admite MISSING y UNRELIABLE (señal de pérdida, ADR-10)', () => {
    expect(positionSchema.safeParse({ position: { x: 1, y: 2 }, quality: 'MISSING' }).success).toBe(
      true,
    );
    expect(
      positionSchema.safeParse({ position: { x: 1, y: 2 }, quality: 'UNRELIABLE' }).success,
    ).toBe(true);
  });

  it('positionSchema rechaza quality no admitido', () => {
    expect(positionSchema.safeParse({ position: { x: 1, y: 2 }, quality: 'PERFECT' }).success).toBe(
      false,
    );
    expect(positionSchema.safeParse({ position: { x: 1, y: 2 } }).success).toBe(false);
  });

  it('positionSchema rechaza position con tipos incorrectos (bordes los valida el servicio)', () => {
    expect(
      positionSchema.safeParse({ position: { x: '1', y: 2 }, quality: 'RELIABLE' }).success,
    ).toBe(false);
    // Fuera del plano: Zod solo valida forma (DD-107); los límites los aplica el servicio.
    expect(
      positionSchema.safeParse({ position: { x: -5, y: 9000 }, quality: 'RELIABLE' }).success,
    ).toBe(true);
  });
});
