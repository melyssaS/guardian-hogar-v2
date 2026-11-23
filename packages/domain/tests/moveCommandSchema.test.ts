import { describe, expect, it } from 'vitest';
import { moveCommandSchema } from '../src/index.js';

// Spec 003 — RC-1 (RF-08.2, RNF-01): comando de movimiento con sesión y secuencia
const SESSION_ID = '5f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const valid = { destination: { x: 250, y: 175 }, sessionId: SESSION_ID, sequence: 1 };

describe('moveCommandSchema', () => {
  it('acepta un comando válido', () => {
    expect(moveCommandSchema.parse(valid)).toEqual(valid);
  });

  it('rechaza sessionId que no es UUID o falta', () => {
    expect(moveCommandSchema.safeParse({ ...valid, sessionId: 'abc' }).success).toBe(false);
    expect(moveCommandSchema.safeParse({ ...valid, sessionId: '' }).success).toBe(false);
    expect(
      moveCommandSchema.safeParse({ destination: valid.destination, sequence: 1 }).success,
    ).toBe(false);
  });

  it('exige sequence entero >= 1', () => {
    expect(moveCommandSchema.safeParse({ ...valid, sequence: 0 }).success).toBe(false);
    expect(moveCommandSchema.safeParse({ ...valid, sequence: -3 }).success).toBe(false);
    expect(moveCommandSchema.safeParse({ ...valid, sequence: 1.5 }).success).toBe(false);
    expect(moveCommandSchema.safeParse({ ...valid, sequence: '2' }).success).toBe(false);
    expect(moveCommandSchema.safeParse({ ...valid, sequence: 7 }).success).toBe(true);
  });

  it('exige destination con forma de punto', () => {
    expect(moveCommandSchema.safeParse({ ...valid, destination: { x: 'a', y: 1 } }).success).toBe(
      false,
    );
    expect(moveCommandSchema.safeParse({ sessionId: SESSION_ID, sequence: 1 }).success).toBe(false);
  });
});
