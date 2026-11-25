import type { Incident } from '../models/guardian.js';
import type { IncidentCounts } from '../models/incidentCounts.js';
import { RULES } from './catalog.js';

/**
 * Pura. Cuenta los incidentes por tipo (`rule`) recorriendo el catálogo `RULES` en orden fijo, de
 * modo que `byType` siempre trae las tres categorías (0 si no hay, CA-08.3). `total` es la suma de
 * los conteos (CA-08.2). Determinista y sin efectos: no muta la entrada (CA-08.4, CA-08.5).
 */
export function countIncidentsByType(incidents: readonly Incident[]): IncidentCounts {
  const byType = RULES.map((rule) => ({
    rule: rule.id,
    title: rule.title,
    count: incidents.reduce((n, incident) => (incident.rule === rule.id ? n + 1 : n), 0),
  }));
  const total = byType.reduce((sum, type) => sum + type.count, 0);
  return { total, byType };
}
