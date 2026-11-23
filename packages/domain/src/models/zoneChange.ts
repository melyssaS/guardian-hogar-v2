import type { Zone } from './zone.js';

/** Acción registrada en el historial de cambios de zona (RF-05.1, DD-013). */
export type ZoneChangeAction = 'CREATE' | 'UPDATE' | 'ACTIVATE' | 'DEACTIVATE' | 'DELETE';

/** Fila del registro inmutable de cambios de zona (RF-05.1, RF-05.4). */
export interface ZoneChange {
  id: number;
  zoneId: number;
  action: ZoneChangeAction;
  /** Estado anterior; `null` en CREATE. */
  before: Zone | null;
  /** Estado posterior; `null` en DELETE. */
  after: Zone | null;
  /** ISO-8601. */
  createdAt: string;
}

/** Campos editables de una zona (excluye `id` y `createdAt`). */
const EDITABLE_FIELDS: readonly (keyof Zone)[] = ['name', 'x', 'y', 'width', 'height', 'active'];

/**
 * Pura. Clasifica un `PUT` según RF-05.3:
 * - solo `active` false→true → `ACTIVATE`; true→false → `DEACTIVATE`;
 * - cualquier otro campo (con o sin `active`) → `UPDATE`;
 * - sin cambios en los campos editables → `null`.
 */
export function classifyZoneUpdate(before: Zone, after: Zone): ZoneChangeAction | null {
  const changed = EDITABLE_FIELDS.filter((field) => before[field] !== after[field]);
  if (changed.length === 0) return null;
  if (changed.length === 1 && changed[0] === 'active') {
    return after.active ? 'ACTIVATE' : 'DEACTIVATE';
  }
  return 'UPDATE';
}
