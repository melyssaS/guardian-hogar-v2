import { describe, expect, it } from 'vitest';
import { pointSchema } from '../src/index.js';

// Spec 003 — RNF-01, RF-01.2 (trasladado a point.schema.ts en spec 002 RC-20)
describe('pointSchema', () => {
  it('pointSchema acepta números (también fuera del plano: lo valida el servicio, DD-107)', () => {
    expect(pointSchema.parse({ x: 250, y: 175 })).toEqual({ x: 250, y: 175 });
    expect(pointSchema.safeParse({ x: -5, y: 9000 }).success).toBe(true);
  });

  it.each([
    [{ x: '1', y: 2 }],
    [{ x: 1 }],
    [{ x: Number.NaN, y: 1 }],
    [{ x: Number.POSITIVE_INFINITY, y: 1 }],
    [null],
  ])('pointSchema rechaza %j', (value) => {
    expect(pointSchema.safeParse(value).success).toBe(false);
  });
});
