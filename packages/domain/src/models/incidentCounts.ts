import type { RuleId } from '../rules/catalog.js';

/**
 * Conteo de incidentes de un tipo (regla del catálogo). "Tipo" = `rule` (DD-08.1).
 * `title` es el título legible de la regla, tomado del catálogo.
 */
export interface IncidentTypeCount {
  rule: RuleId;
  title: string;
  count: number;
}

/**
 * Resumen de conteos de incidentes por tipo (HU-08). `byType` incluye siempre las categorías del
 * catálogo, en su orden, con `0` cuando no hay incidentes (CA-08.3). `total` es la suma (CA-08.2).
 * Tipo sin Zod: vive en `models/`, no en `schemas/` (H-3).
 */
export interface IncidentCounts {
  total: number;
  byType: IncidentTypeCount[];
}
