import type { CollisionType, MoveResponse } from '../types';

/** Etiquetas de presentación. Traducen códigos de la API; no deciden nada (CA-03.6). */
const DECISION_VIEW: Record<MoveResponse['decision'], { label: string; pill: string }> = {
  AUTHORIZED: { label: 'AUTHORIZED · Movimiento autorizado', pill: 'pill success' },
  DENIED: { label: 'DENIED · PARADA PREVENTIVA', pill: 'pill danger' },
  REJECTED: { label: 'REJECTED · Solicitud rechazada', pill: 'pill warn' },
};

export const COLLISION_LABEL: Record<CollisionType, string> = {
  ORIGIN_IN_RESTRICTED_ZONE: 'El robot está dentro de una zona restringida',
  RESTRICTED_ZONE_VIOLATION: 'El destino está dentro de una zona restringida',
  TRAJECTORY_CROSSES_ZONE: 'La trayectoria cruza una zona restringida',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface DecisionPanelProps {
  /** Respuesta de POST /api/robots/:robotId/move, sin transformar (spec 002). */
  result: MoveResponse | null;
}

/**
 * Decisión del vigilante (RF-04.1–RF-04.3). Renderiza exactamente la respuesta de la API:
 * no recibe zonas ni geometría, así que no puede reevaluar reglas (CA-03.6), y muestra el
 * `code` tal como llega, sin inventar uno por defecto.
 */
export function DecisionPanel({ result }: DecisionPanelProps) {
  const zoneName = result?.decision === 'DENIED' ? result.zoneName : null;
  const collisionType = result?.decision === 'DENIED' ? result.collisionType : null;
  const cause = collisionType ?? (result && result.decision !== 'AUTHORIZED' ? result.code : null);

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
          {result.decision === 'DENIED' && (
            <div role="alert" className="callout error" data-testid="preventive-stop">
              <b>Parada preventiva ({result.code}).</b>{' '}
              {result.collisionType ? `${COLLISION_LABEL[result.collisionType]}` : result.reason}
              {result.zoneName && (
                <>
                  : <b>{result.zoneName}</b>
                </>
              )}
              . El robot permanece en su posición. <b>Incidente #{result.incidentId}</b> · regla{' '}
              {result.rule}.
            </div>
          )}
          {result.decision === 'REJECTED' && (
            <div role="alert" className="callout warn" data-testid="rejected">
              <b>Solicitud rechazada ({result.code}).</b> {result.reason}
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
              <label>Calidad de posición</label>
              <b className="info-small" data-testid="result-quality">
                {result.positionQuality}
              </b>
            </div>
            <div className="info-tile">
              <label>Zona</label>
              <b data-testid="result-zone">{zoneName ?? '—'}</b>
            </div>
            <div className="info-tile">
              <label>Causa</label>
              <b className="info-small">{cause ?? '—'}</b>
            </div>
          </div>
          {result.decision !== 'AUTHORIZED' && (
            <p className="note-line" data-testid="reason">
              Motivo: {result.reason}
            </p>
          )}

          <div className="telemetry" aria-label="Respuesta JSON de la API">
            {JSON.stringify(result, null, 2)}
          </div>
        </>
      )}
    </section>
  );
}
