import type { Severity } from '../types';

/**
 * Opciones del selector, de menor a mayor severidad. Constante local para que la UI no importe
 * reglas del dominio (spec 006 DD-612); una prueba la compara con `severitySchema.options`.
 */
export const SEVERITY_OPTIONS: readonly Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

interface IncidentSeverityFilterProps {
  /** Severidad elegida; `null` = todas. */
  value: Severity | null;
  onChange: (value: Severity | null) => void;
  onReset: () => void;
}

/** Filtro por severidad de la vista "Incidentes" (HU-06). Solo emite lo elegido: no filtra. */
export function IncidentSeverityFilter({ value, onChange, onReset }: IncidentSeverityFilterProps) {
  return (
    <>
      <label className="note-line" htmlFor="incident-severity-filter">
        Filtrar por severidad
      </label>
      <select
        id="incident-severity-filter"
        className="btn tight"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as Severity))}
      >
        <option value="">Todas</option>
        {SEVERITY_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button type="button" className="btn tight" disabled={value === null} onClick={onReset}>
        Restablecer filtro
      </button>
    </>
  );
}
