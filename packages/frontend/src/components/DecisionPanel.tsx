import type { CollisionType, Decision, MoveResult } from '../types';

/** Etiquetas de presentación. Traducen códigos de la API; no deciden nada (CA-03.6). */
const DECISION_VIEW: Record<Decision, { label: string; pill: string }> = {
  ALLOW: { label: 'ALLOW · Movimiento permitido', pill: 'pill success' },
  PREVENTIVE_STOP: { label: 'PARADA PREVENTIVA', pill: 'pill danger' },
  DENIED_SAFE_STOP: { label: 'DENEGADO · SAFE_STOP_ACTIVE', pill: 'pill warn' },
};

export const COLLISION_LABEL: Record<CollisionType, string> = {
  ORIGIN_IN_RESTRICTED_ZONE: 'El robot está dentro de una zona restringida',
  RESTRICTED_ZONE_VIOLATION: 'El destino está dentro de una zona restringida',
  TRAJECTORY_CROSSES_ZONE: 'La trayectoria cruza una zona restringida',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface DecisionPanelProps {
  /** Respuesta de POST /api/simulation/move, sin transformar. */
  result: MoveResult | null;
}

/**
 * Decisión del vigilante (RF-04.1–RF-04.3). Renderiza exactamente la respuesta de la API:
 * no recibe zonas ni geometría, así que no puede reevaluar reglas (CA-03.6).
 */
export function DecisionPanel({ result }: DecisionPanelProps) {
  return (
    <section className="card pad" aria-label="Decisión del vigilante" data-testid="decision-panel">
      <div className="section-heading">
        <div>
          <h2 className="card-title">Decisión del vigilante</h2>
          <p className="card-sub">Respuesta del servidor a la última solicitud</p>
        </div>
        {result && (
          <span className={DECISION_VIEW[result.decision].pill} data-testid="decision">
            {DECISION_VIEW[result.decision].label}
          </span>
        )}
      </div>

      {!result ? (
        <div className="empty">
          Aún no hay decisiones. Elija un destino y solicite el movimiento.
        </div>
      ) : (
        <>
          {result.decision === 'PREVENTIVE_STOP' && (
            <div role="alert" className="callout error" data-testid="preventive-stop">
              <b>Parada preventiva.</b>{' '}
              {result.collisionType ? COLLISION_LABEL[result.collisionType] : 'Colisión detectada'}
              {result.zoneName && (
                <>
                  : <b>{result.zoneName}</b>
                </>
              )}
              . El robot permanece en su posición.
            </div>
          )}
          {result.decision === 'DENIED_SAFE_STOP' && (
            <div role="alert" className="callout warn" data-testid="denied">
              <b>Movimiento denegado ({result.code ?? 'SAFE_STOP_ACTIVE'}).</b> El robot está en
              parada segura; libérelo antes de solicitar otro movimiento.
            </div>
          )}

          <div className="info-grid">
            <div className="info-tile">
              <label>Estado devuelto</label>
              <b data-testid="result-state">{result.state}</b>
            </div>
            <div className="info-tile">
              <label>Posición</label>
              <b data-testid="result-position">
                ({fmt(result.position.x)}, {fmt(result.position.y)})
              </b>
            </div>
            <div className="info-tile">
              <label>Zona</label>
              <b data-testid="result-zone">{result.zoneName ?? '—'}</b>
            </div>
            <div className="info-tile">
              <label>Causa</label>
              <b className="info-small">{result.collisionType ?? result.code ?? '—'}</b>
            </div>
          </div>
          <p className="note-line" data-testid="reason">
            Motivo: {result.reason}
          </p>

          <div className="telemetry" aria-label="Respuesta JSON de la API">
            {JSON.stringify(result, null, 2)}
          </div>
        </>
      )}
    </section>
  );
}
