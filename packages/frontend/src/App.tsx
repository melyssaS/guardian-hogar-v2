import { useEffect, useState } from 'react';
import { IncidentsPage } from './pages/IncidentsPage';
import { RobotsPage } from './pages/RobotsPage';
import { RoomsPage } from './pages/RoomsPage';
import { SimulationPage } from './pages/SimulationPage';

/**
 * Vistas disponibles. La ruta vive en el hash para no depender de un router (YAGNI).
 * La barra lateral ofrece solo estas 4 entradas: "Visión general" e "Ingeniería · SDD" están
 * fuera de alcance y no se muestran de ninguna forma (CA-03.28, DD-125). La primera es la
 * vista por defecto, también para rutas desconocidas (CA-03.37, DD-134).
 */
const VIEWS = [
  { hash: '#/supervision', label: 'Supervisión', icon: '◎', Page: SimulationPage },
  { hash: '#/robots', label: 'Robots simulados', icon: '⌗', Page: RobotsPage },
  { hash: '#/zonas', label: 'Zonas y reglas', icon: '⬡', Page: RoomsPage },
  { hash: '#/incidentes', label: 'Incidentes', icon: '⚑', Page: IncidentsPage },
] as const;

type View = (typeof VIEWS)[number];

function viewFromHash(hash: string): View {
  return VIEWS.find((v) => v.hash === hash) ?? VIEWS[0];
}

/** Estructura del prototipo: barra lateral de navegación + vista activa. */
export function App() {
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const { Page } = view;
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="identity">
          <div className="brand-icon">GH</div>
          <div>
            <div className="brand-name">Guardián Hogar</div>
            <div className="brand-sub">LABORATORIO ROBÓTICO</div>
          </div>
        </div>
        <nav className="navgroup" aria-label="Secciones">
          <div className="nav-heading">PLATAFORMA</div>
          {VIEWS.map((v) => (
            <a
              key={v.hash}
              href={v.hash}
              className={`nav${v === view ? ' active' : ''}`}
              aria-current={v === view ? 'page' : undefined}
            >
              <span className="nav-ico">{v.icon}</span>
              {v.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="main">
        <Page key={view.hash} />
      </div>
    </div>
  );
}
