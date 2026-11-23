import { useState } from 'react';
import {
  CoordInput,
  emptyDraft,
  parseDestination,
  toDraft,
  type CoordDraft,
} from '../components/CoordInput';
import { DecisionPanel } from '../components/DecisionPanel';
import { FloorPlan } from '../components/FloorPlan';
import { Toast } from '../components/Toast';
import { useSimulation } from '../hooks/useSimulation';
import { useZones } from '../hooks/useZones';
import type { RobotStateName } from '../types';

const STATE_PILL: Record<RobotStateName, string> = {
  IDLE: 'pill success',
  MOVING: 'pill blue',
  SAFE_STOP: 'pill danger',
  DEGRADED: 'pill danger',
  RECOVERING: 'pill warn',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * HU-03 — Simulación de movimiento con decisión del vigilante (spec 003).
 * La página solo pide y muestra: el estado, la posición y la decisión vienen de la API.
 */
export function SimulationPage() {
  const { zones, status: zoneStatus } = useZones();
  const { robot, lastResult, status, move, reset } = useSimulation();
  const [draft, setDraft] = useState<CoordDraft>(emptyDraft);
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null);
  const notify = (text: string) => setToast((t) => ({ text, seq: (t?.seq ?? 0) + 1 }));

  const destination = parseDestination(draft).point;
  const busy = status.move.loading || status.reset.loading;
  const loadError = status.robot.error ?? zoneStatus.list.error;
  const actionError = status.move.error ?? status.reset.error;

  const handleReset = async () => {
    if (await reset()) notify('Parada liberada: robot en IDLE');
  };

  return (
    <>
      <header className="topbar">
        <div className="top-title">
          <b>Guardián Hogar</b> <span>›</span> <span>Simulación de movimiento</span>
        </div>
        <span className="tag green">
          <span className="dot" />
          SIMULACIÓN LOCAL
        </span>
      </header>

      <main className="content">
        <div className="pagehead">
          <div>
            <div className="eyebrow">PRODUCTO · HU-03</div>
            <h1 className="view-title">Simulación de movimiento</h1>
            <p className="subtitle">
              Elija un destino en el plano o escriba sus coordenadas y compruebe la decisión del
              vigilante.
            </p>
          </div>
          <div className="controls">
            {robot && (
              <span className={STATE_PILL[robot.state]} data-testid="robot-state">
                {robot.state}
              </span>
            )}
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void handleReset()}
            >
              ↻ Liberar parada (reset)
            </button>
          </div>
        </div>

        {loadError && (
          <div role="alert" className="callout error">
            No se pudo cargar la simulación: {loadError}
          </div>
        )}
        {actionError && (
          <div role="alert" className="callout error">
            {actionError}
          </div>
        )}

        <div className="two">
          <section className="card pad">
            <div className="section-heading">
              <div>
                <h2 className="card-title">Plano digital del hogar</h2>
                <p className="card-sub">Haga clic en el plano para fijar el destino del robot</p>
              </div>
              <span className="pill blue">1000 × 800</span>
            </div>
            <div className="mapbox">
              <div className="map-overlay">
                ◉ SIMULACIÓN <span>· NO CONTROL REAL</span>
              </div>
              <FloorPlan
                zones={zones}
                robot={robot}
                destination={destination}
                onSelectPoint={(p) => setDraft(toDraft(p))}
              />
            </div>
            <div className="safety-legend">
              <span>
                <i className="legend-swatch" style={{ background: '#d56b68' }} />
                Zona restringida
              </span>
              <span>
                <i className="legend-swatch" style={{ background: '#b0d6ca' }} />
                Zona permitida
              </span>
              <span>
                <i className="legend-swatch" style={{ background: '#3476cb' }} />
                Robot activo
              </span>
              <span>
                <i className="legend-swatch" style={{ background: '#b84f58' }} />
                Robot detenido
              </span>
            </div>
            <div className="line" />
            <CoordInput
              value={draft}
              onChange={setDraft}
              submitting={busy}
              onSubmit={(p) => void move(p)}
            />
            {/*
              Reservado (spec 003 §7, tarea 18): inyección de fallos de sensor, alerta A-04 y
              prueba T-18, junto con los estados DEGRADED/RECOVERING. Se desarrollan en vivo
              durante la demostración; aquí solo queda el punto de extensión deshabilitado.
            */}
            <div className="controls reserved">
              <button
                type="button"
                className="btn tight"
                disabled
                title="Reservado para la demostración en clase"
              >
                ⌁ Inyectar fallo de sensor · reservado ⌛
              </button>
            </div>
          </section>

          <div className="side-info">
            <section className="card pad" aria-label="Robot simulado">
              <div className="section-heading">
                <div>
                  <h2 className="card-title">Robot simulado</h2>
                  <p className="card-sub">Estado y posición según el servidor</p>
                </div>
                <span className="pill">SIM-001</span>
              </div>
              {robot ? (
                <div className="info-grid">
                  <div className="info-tile">
                    <label>Estado</label>
                    <b>{robot.state}</b>
                  </div>
                  <div className="info-tile">
                    <label>Posición</label>
                    <b data-testid="robot-position">
                      ({fmt(robot.position.x)}, {fmt(robot.position.y)})
                    </b>
                  </div>
                </div>
              ) : (
                <div className="empty">
                  {status.robot.loading ? 'Cargando robot…' : 'Robot no disponible'}
                </div>
              )}
            </section>

            <DecisionPanel result={lastResult} />
          </div>
        </div>

        <p className="note-line" style={{ marginTop: 14 }}>
          El vigilante evalúa cada solicitud en el servidor y registra la decisión. Esta interfaz
          solo muestra la respuesta de la API.
        </p>
      </main>
      <Toast message={toast} />
    </>
  );
}
