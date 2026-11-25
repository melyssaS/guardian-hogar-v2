import type { DecisionCode, IncidentCode } from '../models/guardian.js';

/** Identificador de una regla del catálogo (spec 001 §3.6). */
export type RuleId = 'R-ZONA-01' | 'R-SIGNAL-01' | 'R-DATA-01';

/** Regla de seguridad del vigilante, mostrada en la UI y usada para rellenar `incidents.rule`. */
export interface Rule {
  id: RuleId;
  title: string;
  /** Texto mostrado en la tarjeta de la UI. */
  description: string;
  /** Códigos de denegación que cubre la regla (RF-06.1). */
  decisionCodes: readonly DecisionCode[];
  /** Historias de usuario del backlog relacionadas. */
  stories: readonly string[];
}

/** Catálogo estático de reglas: única fuente para la UI (001/003) y los incidentes (002). */
export const RULES: readonly Rule[] = [
  {
    id: 'R-ZONA-01',
    title: 'No circular por zonas restringidas',
    description:
      'Si el origen, el destino o la trayectoria de un movimiento tocan una zona activa (expandida r+m), el vigilante lo deniega y el robot entra en parada preventiva.',
    decisionCodes: [
      'ORIGIN_IN_RESTRICTED_ZONE',
      'RESTRICTED_ZONE_VIOLATION',
      'TRAJECTORY_CROSSES_ZONE',
    ],
    stories: ['HU-02', 'HU-04'],
  },
  {
    id: 'R-SIGNAL-01',
    title: 'Posición no confiable o ausente',
    description:
      'Si la posición del robot no es confiable o falta, no se evalúa la geometría: el movimiento se deniega y el robot queda en operación degradada.',
    // POSITION_QUALITY_LOST se resuelve en ruleForDecision (no es un DecisionCode).
    decisionCodes: ['INSUFFICIENT_DATA', 'MISSING_POSITION'],
    stories: ['HU-04', 'HU-05'],
  },
  {
    id: 'R-DATA-01',
    title: 'Información de zonas no disponible',
    description:
      'Si no se pueden leer las zonas, el vigilante no puede verificar el movimiento y aplica fallo seguro: parada preventiva.',
    decisionCodes: ['ZONE_DATA_UNAVAILABLE'],
    stories: ['HU-04', 'HU-05'],
  },
];

/** Severidad de un incidente (spec 006, HU-06). Mismo orden que el enum histórico de architecture.md. */
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Códigos que nunca generan incidente: no tienen severidad (spec 006 DD-602). */
type NonIncidentCode = 'AUTHORIZED' | 'SAFE_STOP_ACTIVE' | 'BUSY';

/** Severidad por código de incidente (spec 006 requirements §3.1). TypeScript exige cubrir los 7. */
const SEVERITY_BY_CODE: Readonly<Record<Exclude<IncidentCode, NonIncidentCode>, Severity>> = {
  ORIGIN_IN_RESTRICTED_ZONE: 'CRITICAL',
  RESTRICTED_ZONE_VIOLATION: 'HIGH',
  ZONE_DATA_UNAVAILABLE: 'HIGH',
  TRAJECTORY_CROSSES_ZONE: 'MEDIUM',
  INSUFFICIENT_DATA: 'MEDIUM',
  MISSING_POSITION: 'MEDIUM',
  POSITION_QUALITY_LOST: 'LOW',
};

/**
 * Pura. Severidad derivada del código de un incidente. Lanza ante un código que no genera
 * incidente (`AUTHORIZED`, `SAFE_STOP_ACTIVE`, `BUSY`): nunca inventa una severidad.
 */
export function severityForDecision(code: IncidentCode): Severity {
  const severity = (SEVERITY_BY_CODE as Partial<Record<IncidentCode, Severity>>)[code];
  if (severity === undefined)
    throw new Error(`no severity for code ${code}: it creates no incident`);
  return severity;
}

/**
 * Pura. Devuelve la regla que cubre un código de incidente o `null` si no es una denegación
 * (`AUTHORIZED`, `SAFE_STOP_ACTIVE`, `BUSY`). `POSITION_QUALITY_LOST` pertenece a `R-SIGNAL-01`.
 */
export function ruleForDecision(code: IncidentCode): RuleId | null {
  if (code === 'POSITION_QUALITY_LOST') return 'R-SIGNAL-01';
  const rule = RULES.find((r) => r.decisionCodes.includes(code));
  return rule ? rule.id : null;
}
