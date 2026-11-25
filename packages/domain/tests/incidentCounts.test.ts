import { describe, expect, it } from 'vitest';
import { countIncidentsByType } from '../src/index.js';
import type { Incident } from '../src/index.js';

// Spec 008 — HU-08: función pura de conteo de incidentes por tipo (regla).

/** Incidente mínimo para las pruebas; solo importa `rule`, el resto son valores de relleno. */
function incident(rule: Incident['rule'], id: number): Incident {
  return {
    id,
    robotId: 1,
    robotName: 'Aspiradora A1',
    rule,
    zoneName: null,
    decisionCode: 'RESTRICTED_ZONE_VIOLATION',
    collisionType: null,
    stateAfter: 'SAFE_STOP',
    origin: { x: 0, y: 0 },
    destination: { x: 1, y: 1 },
    reason: 'relleno',
    createdAt: '2025-03-04T15:00:00.000Z',
  };
}

describe('countIncidentsByType', () => {
  it('cuenta por regla y el total es la suma (CA-08.1, CA-08.2)', () => {
    const incidents: Incident[] = [
      incident('R-ZONA-01', 1),
      incident('R-ZONA-01', 2),
      incident('R-SIGNAL-01', 3),
    ];
    const result = countIncidentsByType(incidents);
    expect(result.total).toBe(3);
    expect(result.byType).toEqual([
      { rule: 'R-ZONA-01', title: 'No circular por zonas restringidas', count: 2 },
      { rule: 'R-SIGNAL-01', title: 'Posición no confiable o ausente', count: 1 },
      { rule: 'R-DATA-01', title: 'Información de zonas no disponible', count: 0 },
    ]);
  });

  it('lista vacía → 3 categorías en 0, en orden del catálogo, total 0 (CA-08.3)', () => {
    const result = countIncidentsByType([]);
    expect(result.total).toBe(0);
    expect(result.byType.map((t) => t.rule)).toEqual(['R-ZONA-01', 'R-SIGNAL-01', 'R-DATA-01']);
    expect(result.byType.every((t) => t.count === 0)).toBe(true);
  });

  it('determinista: el mismo conjunto produce los mismos conteos (CA-08.5)', () => {
    const incidents: Incident[] = [incident('R-DATA-01', 1), incident('R-SIGNAL-01', 2)];
    expect(countIncidentsByType(incidents)).toEqual(countIncidentsByType(incidents));
  });

  it('no muta el arreglo de entrada (CA-08.4)', () => {
    const incidents: Incident[] = [incident('R-ZONA-01', 1), incident('R-SIGNAL-01', 2)];
    const snapshot = JSON.parse(JSON.stringify(incidents)) as Incident[];
    countIncidentsByType(incidents);
    expect(incidents).toEqual(snapshot);
  });
});
