import { IncidentDetail } from '../components/IncidentDetail';
import { IncidentTable } from '../components/IncidentTable';
import { useIncidents } from '../hooks/useIncidents';

/**
 * Vista "Incidentes" (HU-05, parte UI): bitácora y detalle, solo lectura (spec 003 RF-09).
 * HU-07 (spec 007): exportar CSV; el archivo lo genera el backend.
 */
export function IncidentsPage() {
  const { incidents, detail, status, select, exportCsv } = useIncidents();
  const error = status.list.error ?? status.detail.error ?? status.export.error;
  const exporting = status.export.loading;

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
          <div className="controls">
            {/* HU-06: filtrar por severidad — reservado para demo en vivo */}
            <button
              type="button"
              className="btn tight"
              disabled
              title="HU-06, reservada para la demostración en clase"
            >
              Filtrar por severidad · HU-06 ⌛
            </button>
            <button
              type="button"
              className="btn tight"
              disabled={exporting}
              title="Descargar los incidentes en CSV"
              onClick={() => void exportCsv()}
            >
              {exporting ? 'Exportando…' : 'Exportar CSV · HU-07'}
            </button>
            <span className="note-line">HU-06 está reservada, no implementada.</span>
          </div>
          <IncidentTable
            incidents={incidents}
            selectedId={detail?.id ?? null}
            onSelect={(id) => void select(id)}
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
