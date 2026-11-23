import { describe, expect, it } from 'vitest';
import { robotInputSchema } from '../src/index.js';

// Spec 003 — RC-1 (RF-07.2, RNF-01): alta de robot, 422 INVALID_ROBOT
describe('robotInputSchema', () => {
  it('acepta nombre y tipo válidos', () => {
    expect(robotInputSchema.parse({ name: 'A1', type: 'VACUUM' })).toEqual({
      name: 'A1',
      type: 'VACUUM',
    });
    expect(robotInputSchema.safeParse({ name: 'V2', type: 'GUARD' }).success).toBe(true);
  });

  it('aplica trim al nombre', () => {
    expect(robotInputSchema.parse({ name: '  Robot  ', type: 'GUARD' }).name).toBe('Robot');
  });

  it('acepta nombres de 1 y 60 caracteres y rechaza 61', () => {
    expect(robotInputSchema.safeParse({ name: 'a', type: 'VACUUM' }).success).toBe(true);
    expect(robotInputSchema.safeParse({ name: 'a'.repeat(60), type: 'VACUUM' }).success).toBe(true);
    expect(robotInputSchema.safeParse({ name: 'a'.repeat(61), type: 'VACUUM' }).success).toBe(
      false,
    );
  });

  it('rechaza nombre vacío o solo espacios', () => {
    expect(robotInputSchema.safeParse({ name: '', type: 'VACUUM' }).success).toBe(false);
    expect(robotInputSchema.safeParse({ name: '    ', type: 'VACUUM' }).success).toBe(false);
  });

  it('el límite de 60 caracteres se mide tras el trim', () => {
    expect(
      robotInputSchema.safeParse({ name: ` ${'a'.repeat(60)} `, type: 'VACUUM' }).success,
    ).toBe(true);
  });

  it('rechaza tipo inválido o ausente y nombre no textual', () => {
    expect(robotInputSchema.safeParse({ name: 'A1', type: 'DRONE' }).success).toBe(false);
    expect(robotInputSchema.safeParse({ name: 'A1' }).success).toBe(false);
    expect(robotInputSchema.safeParse({ name: 5, type: 'VACUUM' }).success).toBe(false);
  });

  it('rechaza campos extra (estado o posición enviados por el cliente)', () => {
    expect(robotInputSchema.safeParse({ name: 'A1', type: 'VACUUM', state: 'IDLE' }).success).toBe(
      false,
    );
    expect(
      robotInputSchema.safeParse({ name: 'A1', type: 'VACUUM', position: { x: 1, y: 1 } }).success,
    ).toBe(false);
  });
});
