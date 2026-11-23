import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DecisionCode, IncidentCode } from '../src/index.js';

// Spec 002 — RC-1a (R5.5, R5.11): IncidentCode = DecisionCode | 'POSITION_QUALITY_LOST'
describe('IncidentCode', () => {
  it('incluye todos los DecisionCode y añade POSITION_QUALITY_LOST', () => {
    expectTypeOf<DecisionCode>().toExtend<IncidentCode>();
    expectTypeOf<'POSITION_QUALITY_LOST'>().toExtend<IncidentCode>();
    expectTypeOf<Exclude<IncidentCode, DecisionCode>>().toEqualTypeOf<'POSITION_QUALITY_LOST'>();
  });

  it('rechaza en compilación códigos desconocidos', () => {
    // @ts-expect-error 'UNKNOWN_CODE' no pertenece a IncidentCode
    const invalid: IncidentCode = 'UNKNOWN_CODE';
    const valid: IncidentCode = 'POSITION_QUALITY_LOST';
    expect(valid).toBe('POSITION_QUALITY_LOST');
    expect(invalid).toBe('UNKNOWN_CODE');
  });
});
