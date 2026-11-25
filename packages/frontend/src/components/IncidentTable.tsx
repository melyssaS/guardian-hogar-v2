import type { Incident } from '../types';

interface IncidentTableProps {
  incidents: Incident[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Mensaje de la tabla vacía; lo decide la página (la tabla no conoce el filtro). */
  emptyMessage?: string;
  /** Anuncia el mensaje vacío a lectores de pantalla (`role="status"`), p. ej. con un filtro activo. */
  emptyIsStatus?: boolean;
}

const DEFAULT_EMPTY = 'Sin incidentes registrados. Provoque una denegación desde Supervisión.';

/** Fecha legible en la zona horaria del navegador; no altera el dato de la API. */
const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-CO');
};

/** Bitácora de incidentes (RF-09.1, RF-09.6): Fecha · Robot · Regla · Zona · Decisión. */
export function IncidentTable({
  incidents,
  selectedId,
  onSelect,
  emptyMessage = DEFAULT_EMPTY,
  emptyIsStatus = false,
}: IncidentTableProps) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Robot</th>
            <th>Regla</th>
            <th>Zona</th>
            <th>Decisión</th>
          </tr>
        </thead>
        <tbody>
          {incidents.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                {emptyIsStatus ? <span role="status">{emptyMessage}</span> : emptyMessage}
              </td>
            </tr>
          ) : (
            incidents.map((i) => (
              <tr
                key={i.id}
                className={`clickable${i.id === selectedId ? ' selected' : ''}`}
                aria-selected={i.id === selectedId}
                tabIndex={0}
                onClick={() => onSelect(i.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(i.id);
                  }
                }}
              >
                <td>{formatDate(i.createdAt)}</td>
                <td>
                  <strong>{i.robotName ?? '—'}</strong>
                </td>
                <td>{i.rule}</td>
                <td>{i.zoneName ?? '—'}</td>
                <td>
                  <span className={i.rule === 'R-SIGNAL-01' ? 'pill warn' : 'pill danger'}>
                    {i.decisionCode}
                  </span>{' '}
                  <span
                    className={`pill severity-${i.severity.toLowerCase()}`}
                    data-severity={i.severity}
                  >
                    {i.severity}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
