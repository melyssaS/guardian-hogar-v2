import { describe, expect, it } from 'vitest';
import { incidentListQuerySchema, severityForDecision, severitySchema } from '../src/index.js';
import type { IncidentCode } from '../src/index.js';

// Spec 006 — HU-06, tarea 1 (CA-06.5, CA-06.6): severidad derivada del código y filtro validado.
describe('severityForDecision (CA-06.6)', () => {
  const table: [IncidentCode, string][] = [
    ['ORIGIN_IN_RESTRICTED_ZONE', 'CRITICAL'],
    ['RESTRICTED_ZONE_VIOLATION', 'HIGH'],
    ['ZONE_DATA_UNAVAILABLE', 'HIGH'],
    ['TRAJECTORY_CROSSES_ZONE', 'MEDIUM'],
    ['INSUFFICIENT_DATA', 'MEDIUM'],
    ['MISSING_POSITION', 'MEDIUM'],
    ['POSITION_QUALITY_LOST', 'LOW'],
  ];

  it.each(table)('%s → %s', (code, severity) => {
    expect(severityForDecision(code)).toBe(severity);
  });

  it.each(['AUTHORIZED', 'SAFE_STOP_ACTIVE', 'BUSY'] as const)(
    '%s no genera incidente: lanza error en lugar de inventar una severidad',
    (code) => {
      expect(() => severityForDecision(code)).toThrow(/severity/i);
    },
  );
});

describe('incidentListQuerySchema con severity (CA-06.5)', () => {
  it('acepta la consulta sin severity', () => {
    expect(incidentListQuerySchema.parse({})).toEqual({});
  });

  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('acepta %s', (severity) => {
    expect(incidentListQuerySchema.parse({ severity })).toEqual({ severity });
  });

  it('se combina con robotId', () => {
    expect(incidentListQuerySchema.parse({ robotId: '1', severity: 'HIGH' })).toEqual({
      robotId: 1,
      severity: 'HIGH',
    });
  });

  it.each([
    ['minúsculas', 'high'],
    ['vacío', ''],
    ['desconocido', 'URGENT'],
    ['array', ['HIGH', 'LOW']],
    ['objeto', { a: 'HIGH' }],
  ])('rechaza %s', (_name, severity) => {
    expect(incidentListQuerySchema.safeParse({ severity }).success).toBe(false);
  });

  it('ignora parámetros desconocidos', () => {
    expect(incidentListQuerySchema.parse({ _: '123', severity: 'LOW' })).toEqual({
      severity: 'LOW',
    });
  });

  it('severitySchema conserva los valores y el orden del enum histórico', () => {
    expect(severitySchema.options).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });
});
