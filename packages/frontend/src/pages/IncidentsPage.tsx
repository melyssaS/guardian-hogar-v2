import { IncidentDetail } from '../components/IncidentDetail';
import { IncidentSeverityFilter } from '../components/IncidentSeverityFilter';
import { IncidentTable } from '../components/IncidentTable';
import { useIncidents } from '../hooks/useIncidents';

/** Vista "Incidentes" (HU-05, parte UI): bitácora y detalle, solo lectura (spec 003 RF-09). */
export function IncidentsPage() {
  const {
    incidents,
    detail,
    status,
    severity,
    activeSeverity,
    setSeverity,
    resetSeverity,
    select,
  } = useIncidents();
  const error = status.list.error ?? status.detail.error;
  // La severidad activa es la de la última respuesta recibida; la página solo elige el mensaje.
  const emptyMessage =
    activeSeverity === null ? undefined : `No hay incidentes de severidad ${activeSeverity}.`;

  return (
    <>
      <header className="topbar">
        <div className="top-title">
          <b>Guardián Hogar</b> <span>›</span> <span>Incidentes</span>
        </div>
        <span className="tag green">
          <span className="dot" />
          SIMULACIÓN LOCAL
        </span>
      </header>

      <main className="content">
        <div className="pagehead">
          <div>
            <div className="eyebrow">PRODUCTO · HU-05</div>
            <h1 className="view-title">Registro de incidentes</h1>
            <p className="subtitle">
              Cada decisión de parada del vigilante deja evidencia de qué ocurrió.
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="callout error">
            {error}
          </div>
        )}

        <div className="card pad">
          <div className="section-heading">
            <div>
              <h2 className="card-title">Bitácora del laboratorio</h2>
              <p className="card-sub">Seleccione un incidente para ver los detalles.</p>
            </div>
            <span className="pill" data-testid="incident-counter">
              {incidents.length} eventos
            </span>
          </div>
          <div className="controls" style={{ paddingBottom: 14 }}>
            {/* HU-06 (spec 006): filtrar por severidad; ocupa el marcador antes reservado. */}
            <IncidentSeverityFilter
              value={severity}
              onChange={setSeverity}
              onReset={resetSeverity}
            />
            <button
              type="button"
              className="btn tight"
              disabled
              title="HU-07, reservada para la demostración en clase"
            >
              Exportar CSV · HU-07 ⌛
            </button>
            <span className="note-line">HU-07 reservada, no implementada.</span>
          </div>
          <IncidentTable
            incidents={incidents}
            selectedId={detail?.id ?? null}
            onSelect={(id) => void select(id)}
            emptyIsStatus={activeSeverity !== null}
            {...(emptyMessage === undefined ? {} : { emptyMessage })}
          />
        </div>

        {detail && (
          <div style={{ marginTop: 14 }}>
            <IncidentDetail incident={detail} />
          </div>
        )}
      </main>
    </>
  );
}
