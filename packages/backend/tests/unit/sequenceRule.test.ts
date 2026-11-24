import { describe, expect, it } from 'vitest';
import { checkSequence } from '../../src/rules/sequenceRule.js';

// Spec 003 — RC-5 (RF-08.3, RF-08.4, Property 7, CA-03.11, CA-03.12)

const SESSION = '5f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER = '6a2d3c4b-5e6f-4071-9b8c-0d1e2f3a4b5c';

describe('checkSequence', () => {
  it('sesión vigente y secuencia mayor que la última → ok', () => {
    expect(
      checkSequence({
        currentSessionId: SESSION,
        lastSequence: 3,
        sessionId: SESSION,
        sequence: 4,
      }),
    ).toEqual({ ok: true });
  });

  it('primera solicitud (lastSequence = 0) con sequence 1 → ok', () => {
    expect(
      checkSequence({
        currentSessionId: SESSION,
        lastSequence: 0,
        sessionId: SESSION,
        sequence: 1,
      }),
    ).toEqual({ ok: true });
  });

  it('una secuencia con salto hacia adelante también es válida (solo se exige que crezca)', () => {
    expect(
      checkSequence({
        currentSessionId: SESSION,
        lastSequence: 1,
        sessionId: SESSION,
        sequence: 9,
      }),
    ).toEqual({ ok: true });
  });

  it('secuencia igual a la última → DUPLICATE_EVENT', () => {
    expect(
      checkSequence({
        currentSessionId: SESSION,
        lastSequence: 3,
        sessionId: SESSION,
        sequence: 3,
      }),
    ).toEqual({ ok: false, code: 'DUPLICATE_EVENT' });
  });

  it('secuencia menor que la última → DUPLICATE_EVENT', () => {
    expect(
      checkSequence({
        currentSessionId: SESSION,
        lastSequence: 3,
        sessionId: SESSION,
        sequence: 2,
      }),
    ).toEqual({ ok: false, code: 'DUPLICATE_EVENT' });
  });

  it('sesión ajena → INVALID_SESSION', () => {
    expect(
      checkSequence({ currentSessionId: SESSION, lastSequence: 0, sessionId: OTHER, sequence: 1 }),
    ).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('robot sin sesión vigente → INVALID_SESSION', () => {
    expect(
      checkSequence({ currentSessionId: null, lastSequence: 0, sessionId: SESSION, sequence: 1 }),
    ).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('INVALID_SESSION tiene prioridad sobre DUPLICATE_EVENT', () => {
    expect(
      checkSequence({ currentSessionId: SESSION, lastSequence: 5, sessionId: OTHER, sequence: 1 }),
    ).toEqual({ ok: false, code: 'INVALID_SESSION' });
  });

  it('es pura: no muta la entrada y repite el mismo resultado', () => {
    const input = { currentSessionId: SESSION, lastSequence: 2, sessionId: SESSION, sequence: 2 };
    const snapshot = { ...input };
    const first = checkSequence(input);
    expect(checkSequence(input)).toEqual(first);
    expect(input).toEqual(snapshot);
  });
});
