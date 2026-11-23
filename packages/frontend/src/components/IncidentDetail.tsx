import type { IncidentDetail as IncidentDetailData, Point } from '../types';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pt = (p: Point) => `(${fmt(p.x)}, ${fmt(p.y)})`;

interface IncidentDetailProps {
  incident: IncidentDetailData;
}

/** Detalle de solo lectura de un incidente, con el snapshot de zonas de la decisión (RF-09.2). */
export function IncidentDetail({ incident }: IncidentDetailProps) {
  return (
    <section className="card pad" aria-label="Detalle del incidente" data-testid="incident-detail">
      <div className="section-heading">
        <div>
          <h2 className="card-title">Incidente #{incident.id}</h2>
          <p className="card-sub">{incident.robotName ?? 'Robot sin nombre'}</p>
        </div>
        <span className="pill danger">{incident.rule}</span>
      </div>
      <div className="info-grid">
        <div className="info-tile">
          <label>Código de decisión</label>
          <b className="info-small">{incident.decisionCode}</b>
        </div>
        <div className="info-tile">
          <label>Tipo de colisión</label>
          <b className="info-small">{incident.collisionType ?? '—'}</b>
        </div>
        <div className="info-tile">
          <label>Estado resultante</label>
          <b className="info-small">{incident.stateAfter}</b>
        </div>
        <div className="info-tile">
          <label>Origen</label>
          <b>{pt(incident.origin)}</b>
        </div>
        <div className="info-tile">
          <label>Destino</label>
          <b>{pt(incident.destination)}</b>
        </div>
        <div className="info-tile">
          <label>Zona</label>
          <b>{incident.zoneName ?? '—'}</b>
        </div>
      </div>
      <p className="note-line">Motivo: {incident.reason}</p>
      <div data-testid="zones-snapshot">
        <h3 className="card-title">Snapshot de zonas</h3>
        {incident.zonesSnapshot.length === 0 ? (
          <div className="empty">Sin zonas en el snapshot</div>
        ) : (
          <ul className="checklist">
            {incident.zonesSnapshot.map((z) => (
              <li key={z.id}>
                <span>
                  {z.name} · {z.active ? 'restringida' : 'permitida'} · ({z.x}, {z.y}) {z.width} ×{' '}
                  {z.height}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
