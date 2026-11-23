import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RobotsPage } from '../../src/pages/RobotsPage';
import type { Robot } from '../../src/types';

// Spec 003 — RC-18/RC-19 (RF-07.8, RF-10.1; CA-03.9, CA-03.10, CA-03.21, CA-03.22, CA-03.35).
const a1: Robot = {
  id: 1,
  name: 'Aspiradora A1',
  type: 'VACUUM',
  createdAt: '2025-01-01T00:00:00.000Z',
  state: 'IDLE',
  position: { x: 120, y: 90 },
  positionQuality: 'RELIABLE',
  lastRequest: null,
};
const v2: Robot = {
  ...a1,
  id: 2,
  name: 'Vigilante V2',
  type: 'GUARD',
  state: 'SAFE_STOP',
  position: { x: 488, y: 290 },
  positionQuality: 'MISSING',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

interface Backend {
  /** Respuesta de `POST /api/robots`; por defecto 201 con el robot creado. */
  register?: { body: unknown; status: number };
}

function install(options: Backend = {}) {
  const robots = [a1, v2];
  const posts: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/robots' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      if (options.register) return json(options.register.body, options.register.status);
      const created: Robot = { ...a1, id: 3, name: (posts.at(-1) as { name: string }).name };
      robots.push(created);
      return json(created, 201);
    }
    if (url === '/api/robots') return json(robots);
    return json({ code: 'NOT_FOUND', message: 'x' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { posts, fetchMock };
}

const openModal = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Registrar robot/ }));
  return screen.findByRole('dialog', { name: /Registrar robot/ });
};

describe('RobotsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('CA-03.21 muestra una tarjeta por robot con nombre, tipo, estado, calidad y posición', async () => {
    install();
    render(<RobotsPage />);

    const cardA1 = await screen.findByTestId('robot-card-1');
    expect(within(cardA1).getByText('Aspiradora A1')).toBeInTheDocument();
    expect(within(cardA1).getByText('Aspiradora')).toBeInTheDocument();
    expect(within(cardA1).getByText('IDLE')).toBeInTheDocument();
    expect(within(cardA1).getByText('RELIABLE')).toBeInTheDocument();
    expect(within(cardA1).getByText('(120, 90)')).toBeInTheDocument();

    const cardV2 = screen.getByTestId('robot-card-2');
    expect(within(cardV2).getByText('Vigilante')).toBeInTheDocument();
    expect(within(cardV2).getByText('SAFE_STOP')).toBeInTheDocument();
    expect(within(cardV2).getByText('MISSING')).toBeInTheDocument();
    expect(within(cardV2).getByText('(488, 290)')).toBeInTheDocument();
  });

  it('CA-03.21 el modal ofrece nombre y tipo (Aspiradora/Vigilante)', async () => {
    install();
    render(<RobotsPage />);
    const dialog = await openModal();

    expect(within(dialog).getByLabelText('Nombre del robot')).toBeInTheDocument();
    const type = within(dialog).getByLabelText('Tipo');
    expect(within(type).getByRole('option', { name: 'Aspiradora' })).toBeInTheDocument();
    expect(within(type).getByRole('option', { name: 'Vigilante' })).toBeInTheDocument();
  });

  it('CA-03.9 registra el robot y aparece en la lista sin enviar estado ni posición', async () => {
    const { posts } = install();
    render(<RobotsPage />);
    const dialog = await openModal();

    await userEvent.type(within(dialog).getByLabelText('Nombre del robot'), 'Robot del pasillo');
    await userEvent.selectOptions(within(dialog).getByLabelText('Tipo'), 'GUARD');
    await userEvent.click(within(dialog).getByRole('button', { name: /Registrar en simulación/ }));

    expect(await screen.findByTestId('robot-card-3')).toHaveTextContent('Robot del pasillo');
    expect(posts).toEqual([{ name: 'Robot del pasillo', type: 'GUARD' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['CA-03.10 422 INVALID_ROBOT', 422, 'INVALID_ROBOT', 'Nombre inválido'],
    ['CA-03.10 409 ROBOT_NAME_DUPLICATE', 409, 'ROBOT_NAME_DUPLICATE', 'Ya existe un robot'],
    [
      'CA-03.22 409 ROBOT_START_IN_RESTRICTED_ZONE',
      409,
      'ROBOT_START_IN_RESTRICTED_ZONE',
      'La posición inicial está en una zona restringida',
    ],
  ])('%s se muestra en el modal y no se crea el robot', async (_t, status, code, message) => {
    install({ register: { status, body: { code, message } } });
    render(<RobotsPage />);
    const dialog = await openModal();

    await userEvent.type(within(dialog).getByLabelText('Nombre del robot'), 'Robot X');
    await userEvent.click(within(dialog).getByRole('button', { name: /Registrar en simulación/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(code);
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByTestId('robot-card-3')).not.toBeInTheDocument();
  });

  it('CA-03.35 409 ROBOT_START_NOT_VERIFIABLE muestra el código y su cause', async () => {
    install({
      register: {
        status: 409,
        body: {
          code: 'ROBOT_START_NOT_VERIFIABLE',
          message: 'No se pudo verificar la posición inicial',
          cause: 'ZONE_DATA_UNAVAILABLE',
        },
      },
    });
    render(<RobotsPage />);
    const dialog = await openModal();

    await userEvent.type(within(dialog).getByLabelText('Nombre del robot'), 'Robot Y');
    await userEvent.click(within(dialog).getByRole('button', { name: /Registrar en simulación/ }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('ROBOT_START_NOT_VERIFIABLE');
    expect(alert).toHaveTextContent('ZONE_DATA_UNAVAILABLE');
  });

  it('Cancelar cierra el modal sin llamar a la API', async () => {
    const { posts } = install();
    render(<RobotsPage />);
    const dialog = await openModal();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });
});
