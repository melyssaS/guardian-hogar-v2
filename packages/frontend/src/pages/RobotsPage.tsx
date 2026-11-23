import { useState } from 'react';
import { RegisterRobotModal } from '../components/RegisterRobotModal';
import { RobotCard } from '../components/RobotCard';
import { useRobots } from '../hooks/useRobots';

/** Vista "Robots simulados": tarjetas del catálogo y alta de robots (spec 003 RF-07). */
export function RobotsPage() {
  const { robots, status, register } = useRobots();
  const [open, setOpen] = useState(false);

  const handleRegister = async (input: Parameters<typeof register>[0]) => {
    const created = await register(input);
    if (created) setOpen(false);
    return created !== null;
  };

  return (
    <>
      <header className="topbar">
        <div className="top-title">
          <b>Guardián Hogar</b> <span>›</span> <span>Robots simulados</span>
        </div>
        <span className="tag green">
          <span className="dot" />
          SIMULACIÓN LOCAL
        </span>
      </header>

      <main className="content">
        <div className="pagehead">
          <div>
            <div className="eyebrow">PRODUCTO · HU-01</div>
            <h1 className="view-title">Robots simulados</h1>
            <p className="subtitle">
              Catálogo de robots del laboratorio. Registre uno nuevo para supervisarlo en el plano.
            </p>
          </div>
          <button type="button" className="btn primary" onClick={() => setOpen(true)}>
            ＋ Registrar robot
          </button>
        </div>

        {status.list.error && (
          <div role="alert" className="callout error">
            No se pudo cargar el catálogo: {status.list.error}
          </div>
        )}

        {robots.length === 0 && !status.list.loading && !status.list.error ? (
          <div className="empty">Aún no hay robots registrados.</div>
        ) : (
          <div className="three">
            {robots.map((r) => (
              <RobotCard key={r.id} robot={r} />
            ))}
          </div>
        )}
      </main>

      {open && (
        <RegisterRobotModal
          submitting={status.register.loading}
          error={status.register.error}
          onSubmit={handleRegister}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
