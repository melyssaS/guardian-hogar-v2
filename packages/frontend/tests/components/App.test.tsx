import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';

// Spec 003 — RC-18/RC-19 (RF-10.1; CA-03.28, CA-03.37): barra lateral de 4 vistas y navegación.
describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const robot = {
          id: 1,
          name: 'Aspiradora A1',
          type: 'VACUUM',
          createdAt: '2025-01-01T00:00:00.000Z',
          state: 'IDLE',
          position: { x: 120, y: 90 },
          positionQuality: 'RELIABLE',
          lastRequest: null,
        };
        const body =
          url === '/api/robots/1/state'
            ? { robotId: 1, ...robot }
            : url === '/api/robots'
              ? [robot]
              : [];
        return new Response(JSON.stringify(body), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const sidebar = () => screen.getByRole('navigation', { name: 'Secciones' });

  it('CA-03.28 la barra lateral ofrece exactamente 4 entradas, en orden', () => {
    render(<App />);
    const links = within(sidebar()).getAllByRole('link');
    const labelOf = (l: HTMLElement) =>
      (l.textContent ?? '').replace(l.querySelector('.nav-ico')?.textContent ?? '', '').trim();
    expect(links.map(labelOf)).toEqual([
      'Supervisión',
      'Robots simulados',
      'Zonas y reglas',
      'Incidentes',
    ]);
  });

  it('CA-03.28 no hay vistas excluidas, ni deshabilitadas, ni "Fuera del MVP"/"reservado"', () => {
    render(<App />);
    const nav = sidebar();
    const forbidden = [
      'Visión general',
      'Ingeniería · SDD',
      'Backlog',
      'Proceso SDD',
      'Agentes de IA',
      'Arquitectura',
      'DevOps',
      'Fuera del MVP',
      'reservado',
    ];
    for (const text of forbidden) {
      expect(within(nav).queryByText(new RegExp(text, 'i'))).not.toBeInTheDocument();
    }
    expect(nav.querySelector('[disabled], [aria-disabled="true"]')).toBeNull();
    expect(within(nav).queryByText(/INGENIERÍA/i)).not.toBeInTheDocument();
  });

  it('CA-03.37 sin ruta abre Supervisión (#/supervision)', async () => {
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Simulación de movimiento' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Supervisión/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /Supervisión/ })).toHaveAttribute(
      'href',
      '#/supervision',
    );
  });

  it('CA-03.37 una ruta desconocida también abre Supervisión', async () => {
    window.location.hash = '#/no-existe';
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Simulación de movimiento' }),
    ).toBeInTheDocument();
  });

  it.each([
    ['Robots simulados', /Robots simulados/, 'Robots simulados'],
    ['Zonas y reglas', /Zonas y reglas/, 'Zonas y reglas de seguridad'],
    ['Incidentes', /Incidentes/, 'Registro de incidentes'],
  ])('CA-03.28 la entrada "%s" abre su vista', async (_name, link, heading) => {
    render(<App />);
    await userEvent.click(within(sidebar()).getByRole('link', { name: link }));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: link })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
