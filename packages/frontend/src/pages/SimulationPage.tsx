import { useEffect, useState } from 'react';
import {
  CoordInput,
  emptyDraft,
  parseDestination,
  toDraft,
  type CoordDraft,
} from '../components/CoordInput';
import { DecisionPanel } from '../components/DecisionPanel';
import { FloorPlan } from '../components/FloorPlan';
import { QUALITY_PILL, STATE_PILL } from '../components/pills';
import { TelemetryPanel } from '../components/TelemetryPanel';
import { Toast } from '../components/Toast';
import { useIncidents } from '../hooks/useIncidents';
import { useRobot } from '../hooks/useRobot';
import { useRobots } from '../hooks/useRobots';
import { useZones } from '../hooks/useZones';

/** Robot de la semilla (A1) seleccionado por defecto. */
const DEFAULT_ROBOT_ID = 1;

/** Robot pedido en el hash (`#/supervision?robot=2`); sin parámetro válido, el de la semilla. */
function requestedRobotId(): number {
  const query = window.location.hash.split('?')[1] ?? '';
  const raw = new URLSearchParams(query).get('robot');
  const id = raw === null ? NaN : Number(raw);
  return Number.isInteger(id) && id > 0 ? id : DEFAULT_ROBOT_ID;
}

/** Zona del catálogo que el prototipo usa para probar la parada preventiva. */
const STAIRS_ZONE_NAME = 'Escaleras';
/** Reglas cuyos incidentes son decisiones de parada del vigilante (DD-128). */
const STOP_RULES: readonly string[] = ['R-ZONA-01', 'R-DATA-01'];
const SIGNAL_RULE = 'R-SIGNAL-01';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * HU-03 — Simulación de movimiento con decisión del vigilante (spec 003).
 * La página solo pide y muestra: el estado, la posición y la decisión vienen de la API.
 */
export function SimulationPage() {
  const { zones, status: zoneStatus } = useZones();
  const { robots, status: listStatus, refresh: refreshRobots } = useRobots();
  const { incidents, status: incidentStatus, refresh: refreshIncidents } = useIncidents();
  const [selectedId, setSelectedId] = useState(requestedRobotId);
  // Si el id pedido no está en el catálogo, se cae al primer robot de la lista.
  useEffect(() => {
    const first = robots[0];
    if (first && !robots.some((r) => r.id === selectedId)) setSelectedId(first.id);
  }, [robots, selectedId]);
  const { robot, lastResult, lastExchange, status, move, recover, loseSignal, restoreSignal } =
    useRobot(selectedId);
  const [draft, setDraft] = useState<CoordDraft>(emptyDraft);
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null);
  const notify = (text: string) => setToast((t) => ({ text, seq: (t?.seq ?? 0) + 1 }));

  const destination = parseDestination(draft).point;
  const busy = status.move.loading || status.recover.loading || status.signal.loading || !robot;
  const loadError =
    status.robot.error ??
    listStatus.list.error ??
    zoneStatus.list.error ??
    incidentStatus.list.error;
  const actionError = status.move.error ?? status.recover.error ?? status.signal.error;

  // El plano pinta todos los robots; el seleccionado usa el estado más reciente de la API.
  const planRobots = robots.map((r) =>
    r.id === selectedId && robot ? { ...r, state: robot.state, position: robot.position } : r,
  );
  const selected = robots.find((r) => r.id === selectedId);

  // Indicadores (RF-10.3): todos derivan de lo que devuelve la API; la UI no lleva contadores.
  const activeRobots = planRobots.filter(
    (r) => r.state !== 'SAFE_STOP' && r.state !== 'DEGRADED',
  ).length;
  const stopDecisions = incidents.filter((i) => STOP_RULES.includes(i.rule)).length;
  const signalLosses = incidents.filter((i) => i.rule === SIGNAL_RULE).length;
  const requestsProcessed = robot?.lastRequest?.sequence ?? 0;
  const restrictedZones = zones.filter((z) => z.active).length;

  /** Tras cada acción se vuelve a pedir la lista para que el plano refleje a todos los robots. */
  const act = async <T,>(action: () => Promise<T>): Promise<T> => {
    const result = await action();
    await Promise.all([refreshRobots(), refreshIncidents()]);
    return result;
  };

  // La zona se busca por nombre en lo que devuelve la API. Solo se declara "inexistente" cuando
  // las zonas ya cargaron sin error: mientras cargan (o si fallan) el botón no se bloquea.
  const stairs = zones.find((z) => z.name === STAIRS_ZONE_NAME);
  const stairsMissing = !zoneStatus.list.loading && !zoneStatus.list.error && !stairs;
  const stairsMissingNotice = `No existe la zona «${STAIRS_ZONE_NAME}»; créela en Zonas y reglas`;

  /**
   * "⚠ Enviar a escaleras" (RF-10.4, DD-115): el destino es el centro de la zona leída de la API.
   * No evalúa colisiones: solo envía el destino y muestra la decisión del vigilante.
   */
  const handleStairs = async () => {
    if (zoneStatus.list.error) {
      notify('No se pudieron leer las zonas; reintente');
      return;
    }
    if (!stairs?.active) {
      notify('Escaleras está permitida; restrínjala antes de probar la parada');
      return;
    }
    await act(() =>
      move({
        x: Math.round(stairs.x + stairs.width / 2),
        y: Math.round(stairs.y + stairs.height / 2),
      }),
    );
  };

  const handleRecover = async () => {
    const result = await act(recover);
    if (!result) return;
    notify(result.transitioned ? 'Parada liberada: robot en IDLE' : 'El robot ya estaba en IDLE');
  };

  const chooseRobot = (id: number) => {
    setSelectedId(id);
    setDraft(emptyDraft);
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
              onClick={() => void handleRecover()}
            >
              ↻ Liberar parada
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

        <div className="kpis">
          <div className="card kpi">
            <div className="kpi-top">Robots activos</div>
            <div className="kpi-val" data-testid="kpi-active">
              {activeRobots}
            </div>
            <div className="kpi-note">Sin parada ni señal perdida</div>
          </div>
          <div className="card kpi">
            <div className="kpi-top">Decisiones de parada</div>
            <div className="kpi-val" data-testid="kpi-stops">
              {stopDecisions}
            </div>
            <div className="kpi-note">Reglas R-ZONA-01 y R-DATA-01</div>
          </div>
          <div className="card kpi">
            <div className="kpi-top">Pérdidas de señal</div>
            <div className="kpi-val" data-testid="kpi-signals">
              {signalLosses}
            </div>
            <div className="kpi-note">Regla R-SIGNAL-01</div>
          </div>
          <div className="card kpi">
            <div className="kpi-top">Solicitudes procesadas</div>
            <div className="kpi-val" data-testid="kpi-requests">
              {requestsProcessed}
            </div>
            <div className="kpi-note">Del robot seleccionado</div>
          </div>
          <div className="card kpi">
            <div className="kpi-top">Zonas restringidas</div>
            <div className="kpi-val" data-testid="kpi-zones">
              {restrictedZones}
            </div>
            <div className="kpi-note">Zonas activas</div>
          </div>
        </div>

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
                robots={planRobots}
                selectedRobotId={selectedId}
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
              onSubmit={(p) => void act(() => move(p))}
            />
            {/*
              Reservado (spec 003 §7, tarea 18): inyección de fallos de sensor, alerta A-04 y
              prueba T-18, junto con los estados DEGRADED/RECOVERING. Se desarrollan en vivo
              durante la demostración; aquí solo queda el punto de extensión deshabilitado.
            */}
            <div className="controls">
              <button
                type="button"
                className="btn danger tight"
                disabled={busy || stairsMissing}
                title={stairsMissing ? stairsMissingNotice : undefined}
                onClick={() => void handleStairs()}
              >
                ⚠ Enviar a escaleras
              </button>
              <button
                type="button"
                className="btn tight"
                disabled={busy}
                onClick={() => void act(loseSignal)}
              >
                ⌁ Perder conexión
              </button>
              <button
                type="button"
                className="btn tight"
                disabled={busy}
                onClick={() => void act(restoreSignal)}
              >
                ↻ Recuperar señal
              </button>
            </div>
            {stairsMissing && (
              <p className="note-line" data-testid="stairs-missing">
                {stairsMissingNotice}
              </p>
            )}
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
                <span className="pill">{selected?.name ?? `Robot ${selectedId}`}</span>
              </div>
              <label className="label" htmlFor="robot-picker">
                Elegir robot
              </label>
              <select
                id="robot-picker"
                className="field"
                style={{ width: '100%', marginBottom: 15 }}
                value={String(selectedId)}
                onChange={(e) => chooseRobot(Number(e.target.value))}
              >
                {robots.length === 0 && <option value={selectedId}>Robot {selectedId}</option>}
                {robots.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {robot ? (
                <div className="info-grid">
                  <div className="info-tile">
                    <label>Estado</label>
                    <b>{robot.state}</b>
                  </div>
                  <div className="info-tile">
                    <label>Calidad de posición</label>
                    <b data-testid="robot-quality">
                      <span className={QUALITY_PILL[robot.positionQuality]}>
                        {robot.positionQuality}
                      </span>
                    </b>
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
            <TelemetryPanel
              request={lastExchange?.request ?? null}
              response={lastExchange?.response ?? null}
            />
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
