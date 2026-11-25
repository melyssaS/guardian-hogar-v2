import type { Incident } from '@home-guardian/domain';

/**
 * Spec 007 (HU-07) — codificador CSV puro de incidentes. Sin efectos secundarios: el servicio lee
 * los incidentes y el controller responde. CA-07.1, 07.3, 07.4, 07.6, 07.9.
 */

/** Orden fijo de columnas del contrato (CA-07.1). */
export const INCIDENT_CSV_HEADERS = [
  'id',
  'robotId',
  'robotName',
  'rule',
  'zoneName',
  'decisionCode',
  'collisionType',
  'stateAfter',
  'originX',
  'originY',
  'destX',
  'destY',
  'reason',
  'createdAt',
] as const;

/** BOM UTF-8: Excel abre bien los acentos (CA-07.4, decisión humana I-5). */
const BOM = '\uFEFF';
/** Separador de filas RFC 4180. */
const EOL = '\r\n';
/** Inicios que una hoja de cálculo interpretaría como fórmula (OWASP CSV Injection, CA-07.9). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Caracteres que obligan a entrecomillar (RFC 4180, CA-07.3). */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * `text`: texto libre que puede venir del operador (se mitiga). `plain`: números y vocabulario
 * cerrado (no se mitiga; un número negativo no debe ganar un apóstrofo).
 */
export type CsvCellKind = 'text' | 'plain';

/** Una celda: `null` → vacía, mitigación de fórmulas (solo `text`) y después escape RFC 4180. */
export function toCsvCell(value: string | number | null, kind: CsvCellKind): string {
  if (value === null) return '';
  let cell = String(value);
  if (kind === 'text' && FORMULA_START.test(cell)) cell = `'${cell}`;
  return NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

function toRow(i: Incident): string {
  return [
    toCsvCell(i.id, 'plain'),
    toCsvCell(i.robotId, 'plain'),
    toCsvCell(i.robotName, 'text'),
    toCsvCell(i.rule, 'plain'),
    toCsvCell(i.zoneName, 'text'),
    toCsvCell(i.decisionCode, 'plain'),
    toCsvCell(i.collisionType, 'plain'),
    toCsvCell(i.stateAfter, 'plain'),
    toCsvCell(i.origin.x, 'plain'),
    toCsvCell(i.origin.y, 'plain'),
    toCsvCell(i.destination.x, 'plain'),
    toCsvCell(i.destination.y, 'plain'),
    toCsvCell(i.reason, 'text'),
    toCsvCell(i.createdAt, 'plain'),
  ].join(',');
}

/** BOM + encabezados + una fila por incidente, en el orden recibido (CA-07.1, CA-07.6). */
export function incidentsToCsv(incidents: readonly Incident[]): string {
  return BOM + [INCIDENT_CSV_HEADERS.join(','), ...incidents.map(toRow)].join(EOL);
}
