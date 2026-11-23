import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';

// Navegación entre HU-01/02 (zonas) y HU-03 (simulación).
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

  it('abre por defecto Zonas y reglas', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Zonas y reglas de seguridad' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Zonas y reglas/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('navega a la simulación desde la barra lateral', async () => {
    render(<App />);
    await userEvent.click(screen.getByRole('link', { name: /Simulación/ }));
    expect(
      await screen.findByRole('heading', { name: 'Simulación de movimiento' }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('robot-1')).toBeInTheDocument();
  });
});
