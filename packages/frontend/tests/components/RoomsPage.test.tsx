import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomsPage } from '../../src/pages/RoomsPage';
import type { Zone } from '../../src/types';

const seed = (): Zone[] =>
  [
    ['Sala', 29, 30, 250, 178, false],
    ['Cocina', 296, 30, 270, 178, false],
    ['Escaleras', 29, 226, 160, 178, true],
    ['Cuarto del bebé', 206, 226, 187, 178, true],
    ['Pasillo', 410, 226, 156, 178, false],
  ].map(([name, x, y, width, height, active], i) => ({
    id: i + 1,
    name: name as string,
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
    active: active as boolean,
    createdAt: '2025-01-01T00:00:00.000Z',
  }));

/** Backend en memoria con el contrato de /api/zones. */
function fakeBackend() {
  let zones = seed();
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const id = Number(url.match(/\/api\/zones\/(\d+)/)?.[1]);
    if (init?.method === 'PUT') {
      zones = zones.map((z) => (z.id === id ? { ...z, ...JSON.parse(String(init.body)) } : z));
      return json(zones.find((z) => z.id === id));
    }
    if (init?.method === 'DELETE') {
      zones = zones.filter((z) => z.id !== id);
      return new Response(null, { status: 204 });
    }
    return json(zones);
  });
}

describe('RoomsPage (comportamiento del prototipo)', () => {
  beforeEach(() => vi.stubGlobal('fetch', fakeBackend()));
  afterEach(() => vi.unstubAllGlobals());

  it('arranca con las 5 habitaciones del prototipo y 2 restringidas', async () => {
    render(<RoomsPage />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5));
    expect(screen.getByTestId('restricted-count')).toHaveTextContent('2 restringidas');
    expect(screen.getByTestId('zone-3')).toHaveAttribute('data-state', 'restricted');
    expect(screen.getByTestId('zone-4')).toHaveAttribute('data-state', 'restricted');
    for (const id of [1, 2, 5]) {
      expect(screen.getByTestId(`zone-${id}`)).toHaveAttribute('data-state', 'allowed');
    }
  });

  it('restringir una habitación la marca en el plano, actualiza el contador y avisa', async () => {
    const user = userEvent.setup();
    render(<RoomsPage />);
    await user.click(await screen.findByRole('button', { name: 'Restringir Pasillo' }));

    await waitFor(() =>
      expect(screen.getByTestId('zone-5')).toHaveAttribute('data-state', 'restricted'),
    );
    expect(screen.getByRole('button', { name: 'Permitir Pasillo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('restricted-count')).toHaveTextContent('3 restringidas');
    expect(screen.getByRole('status')).toHaveTextContent('Pasillo restringida');
  });

  it('permitir una habitación restringida la pasa a área permitida', async () => {
    const user = userEvent.setup();
    render(<RoomsPage />);
    await user.click(await screen.findByRole('button', { name: 'Permitir Escaleras' }));

    await waitFor(() =>
      expect(screen.getByTestId('zone-3')).toHaveAttribute('data-state', 'allowed'),
    );
    expect(screen.getByTestId('restricted-count')).toHaveTextContent('1 restringida');
    expect(screen.getByRole('status')).toHaveTextContent('Escaleras permitida');
  });
});
