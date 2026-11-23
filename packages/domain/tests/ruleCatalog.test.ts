import { describe, expect, it } from 'vitest';
import { RULES, ruleForDecision } from '../src/index.js';
import type { DecisionCode, RuleId } from '../src/index.js';

// Spec 001 — RC-1 (RF-06.1, RF-06.2, CA-02.13, Property 8)
const DENIAL_CODES: readonly DecisionCode[] = [
  'ORIGIN_IN_RESTRICTED_ZONE',
  'RESTRICTED_ZONE_VIOLATION',
  'TRAJECTORY_CROSSES_ZONE',
  'INSUFFICIENT_DATA',
  'MISSING_POSITION',
  'ZONE_DATA_UNAVAILABLE',
];

describe('catálogo de reglas RULES', () => {
  it('contiene exactamente R-ZONA-01, R-SIGNAL-01 y R-DATA-01', () => {
    const ids = RULES.map((r) => r.id).sort();
    expect(ids).toEqual(['R-DATA-01', 'R-SIGNAL-01', 'R-ZONA-01']);
  });

  it('cada código de denegación aparece en exactamente una regla', () => {
    for (const code of DENIAL_CODES) {
      const owners = RULES.filter((r) => r.decisionCodes.includes(code));
      expect(owners, code).toHaveLength(1);
    }
  });

  it('ningún código no denegatorio aparece en una regla', () => {
    const all = RULES.flatMap((r) => [...r.decisionCodes]);
    expect([...all].sort()).toEqual([...DENIAL_CODES].sort());
  });

  it('cada regla tiene título, descripción e historias', () => {
    for (const rule of RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
      expect(rule.stories.length).toBeGreaterThan(0);
    }
  });
});

describe('ruleForDecision', () => {
  it('devuelve la regla correcta para cada denegación', () => {
    const expected: Record<string, RuleId> = {
      ORIGIN_IN_RESTRICTED_ZONE: 'R-ZONA-01',
      RESTRICTED_ZONE_VIOLATION: 'R-ZONA-01',
      TRAJECTORY_CROSSES_ZONE: 'R-ZONA-01',
      INSUFFICIENT_DATA: 'R-SIGNAL-01',
      MISSING_POSITION: 'R-SIGNAL-01',
      ZONE_DATA_UNAVAILABLE: 'R-DATA-01',
    };
    for (const code of DENIAL_CODES) {
      expect(ruleForDecision(code), code).toBe(expected[code]);
    }
  });

  it('devuelve null para AUTHORIZED, SAFE_STOP_ACTIVE y BUSY', () => {
    expect(ruleForDecision('AUTHORIZED')).toBeNull();
    expect(ruleForDecision('SAFE_STOP_ACTIVE')).toBeNull();
    expect(ruleForDecision('BUSY')).toBeNull();
  });

  it('POSITION_QUALITY_LOST devuelve R-SIGNAL-01 (Q-B)', () => {
    expect(ruleForDecision('POSITION_QUALITY_LOST')).toBe('R-SIGNAL-01');
  });
});
