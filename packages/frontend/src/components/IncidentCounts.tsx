import type { IncidentCounts as Counts } from '../types';
import type { OperationState } from '../hooks/useRobot';

interface IncidentCountsProps {
  counts: Counts;
  /** Carga/error de la consulta de conteos, aislado en `status.counts` (H-5, CA-08.9). */
  status: OperationState;
}

/**
 * HU-08: tarjetas KPI con el conteo de incidentes por tipo (regla) y el total. Solo presentación:
 * pinta lo que recibe, no calcula nada (RNF-03). Resuelve su propia carga/error local, sin tocar
 * la tabla, el detalle ni el callout global de la página (CA-08.9).
 */
export function IncidentCounts({ counts, status }: IncidentCountsProps) {
  if (status.error) {
    return (
      <div role="alert" className="callout warn" data-testid="counts-error">
        No se pudieron cargar los conteos: {status.error}
      </div>
    );
  }

  // `byType` llega de la API; si aún no hay datos se trata como vacío para no romper el render.
  const byType = counts.byType ?? [];

  return (
    <div className="four" data-testid="incident-counts" aria-busy={status.loading}>
      {byType.map((type) => (
        <div className="card kpi" key={type.rule} data-testid={`count-${type.rule}`}>
          <div className="kpi-top">
            {type.title} <span className="kpi-ico">⚑</span>
          </div>
          <div className="kpi-val">{type.count}</div>
          <div className="kpi-note">{type.rule}</div>
        </div>
      ))}
      <div className="card kpi" data-testid="count-total">
        <div className="kpi-top">
          Total de incidentes <span className="kpi-ico">Σ</span>
        </div>
        <div className="kpi-val">{counts.total}</div>
        <div className="kpi-note">Todos los tipos</div>
      </div>
    </div>
  );
}
