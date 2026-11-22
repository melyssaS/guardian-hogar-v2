import { describe, expect, it } from 'vitest';
import { createZoneSchema, listZoneQuerySchema, updateZoneSchema } from '../src/index.js';

describe('esquemas Zod de zona', () => {
  it('create aplica active=true por defecto', () => {
    const parsed = createZoneSchema.parse({ name: ' A ', x: 0, y: 0, width: 1, height: 1 });
    expect(parsed).toEqual({ name: 'A', x: 0, y: 0, width: 1, height: 1, active: true });
  });

  it('create acepta width negativo (lo valida el servicio, DD-007)', () => {
    expect(
      createZoneSchema.safeParse({ name: 'A', x: 0, y: 0, width: -1, height: 1 }).success,
    ).toBe(true);
  });

  it('create rechaza nombre vacío o tipos incorrectos', () => {
    expect(
      createZoneSchema.safeParse({ name: '  ', x: 0, y: 0, width: 1, height: 1 }).success,
    ).toBe(false);
    expect(
      createZoneSchema.safeParse({ name: 'A', x: '0', y: 0, width: 1, height: 1 }).success,
    ).toBe(false);
  });

  it('update parcial no fuerza active', () => {
    expect(updateZoneSchema.parse({ name: 'B' })).toEqual({ name: 'B' });
  });

  it('list acepta solo all|false', () => {
    expect(listZoneQuerySchema.safeParse({ active: 'all' }).success).toBe(true);
    expect(listZoneQuerySchema.safeParse({}).success).toBe(true);
    expect(listZoneQuerySchema.safeParse({ active: 'true' }).success).toBe(false);
  });
});
