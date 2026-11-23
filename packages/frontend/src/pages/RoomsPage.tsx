import { useState } from 'react';
import { FloorPlan } from '../components/FloorPlan';
import { RulesCatalog } from '../components/RulesCatalog';
import { Toast } from '../components/Toast';
import { ZoneForm } from '../components/ZoneForm';
import { ZoneList } from '../components/ZoneList';
import { useZones } from '../hooks/useZones';
import type { Zone } from '../types';

/** HU-01 (plano) + HU-02 (gestión de zonas), con el diseño del prototipo. */
export function RoomsPage() {
  const { zones, status, create, update, setActive, remove } = useZones();
  const [editing, setEditing] = useState<Zone | null>(null);
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null);
  const notify = (text: string) => setToast((t) => ({ text, seq: (t?.seq ?? 0) + 1 }));

  const mutationError = status.create.error ?? status.update.error ?? status.remove.error;
  const busy = status.create.loading || status.update.loading || status.remove.loading;
  const restricted = zones.filter((z) => z.active).length;

  const toggle = async (z: Zone) => {
    if (await setActive(z.id, !z.active)) {
      notify(`${z.name} ${z.active ? 'permitida' : 'restringida'}`);
    }
  };

  const handleDelete = async (z: Zone) => {
    if (editing?.id === z.id) setEditing(null);
    if (await remove(z.id)) notify(`${z.name} eliminada`);
  };

  return (
    <>
      <header className="topbar">
        <div className="top-title">
          <b>Guardián Hogar</b> <span>›</span> <span>Zonas y reglas</span>
        </div>
        <span className="tag green">
          <span className="dot" />
          SIMULACIÓN LOCAL
        </span>
      </header>

      <main className="content">
        <div className="pagehead">
          <div>
            <div className="eyebrow">PRODUCTO · HU-01 / HU-02</div>
            <h1 className="view-title">Zonas y reglas de seguridad</h1>
            <p className="subtitle">
              Defina en qué lugares pueden circular los robots y observe el efecto en el plano.
            </p>
          </div>
          <span className="tag blue">REGLAS DETERMINISTAS</span>
        </div>

        {status.list.error && (
          <div role="alert" className="callout error">
            No se pudieron cargar las zonas: {status.list.error}
          </div>
        )}
        {mutationError && (
          <div role="alert" className="callout error">
            {mutationError}
          </div>
        )}

        <div className="two">
          <section className="card pad">
            <div className="section-heading">
              <div>
                <h2 className="card-title">Plano digital del hogar</h2>
                <p className="card-sub">
                  Las zonas restringidas se destacan con borde rojo discontinuo
                </p>
              </div>
              <span className="pill blue">1000 × 800</span>
            </div>
            <div className="mapbox">
              <FloorPlan zones={zones} />
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
            </div>
          </section>

          <div className="side-info">
            <section className="card pad">
              <div className="section-heading">
                <div>
                  <h2 className="card-title">Habitaciones del hogar</h2>
                  <p className="card-sub">
                    Cambie el estado de cada habitación y observe el efecto en el plano
                  </p>
                </div>
                <span className="pill" data-testid="restricted-count">
                  {restricted} restringida{restricted === 1 ? '' : 's'}
                </span>
              </div>
              {status.list.loading && zones.length === 0 ? (
                <div className="empty">Cargando habitaciones…</div>
              ) : (
                <ZoneList
                  zones={zones}
                  busy={busy}
                  onToggleActive={(z) => void toggle(z)}
                  onEdit={setEditing}
                  onDelete={(z) => void handleDelete(z)}
                />
              )}
              <p className="note-line" style={{ marginTop: 16 }}>
                Los cambios se guardan en la base de datos y se conservan al recargar.
              </p>
            </section>

            {editing ? (
              <ZoneForm
                key={editing.id}
                initial={editing}
                submitting={busy}
                onSubmit={async (input) => {
                  const ok = await update(editing.id, input);
                  if (ok) {
                    setEditing(null);
                    notify(`${input.name} actualizada`);
                  }
                  return ok;
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <ZoneForm
                submitting={busy}
                onSubmit={async (input) => {
                  const ok = await create(input);
                  if (ok) notify(`${input.name} creada`);
                  return ok;
                }}
              />
            )}

            <RulesCatalog />
          </div>
        </div>
      </main>
      <Toast message={toast} />
    </>
  );
}
