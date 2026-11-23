import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientToFloor } from '../../src/components/FloorPlan';
import { SimulationPage } from '../../src/pages/SimulationPage';
import type { MoveResult, RobotSnapshot, Zone } from '../../src/types';

// Spec 003 — tarea 22 (CA-03.6, CA-03.7) y tarea 17 (RF-04.4).
const stairs: Zone = {
  id: 3,
  name: 'Escaleras',
  x: 29,
  y: 226,
  width: 160,
  height: 178,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

/**
 * Backend falso: responde siempre con `nextResult` y registra los cuerpos de /move.
 * Así se comprueba que la UI muestra la respuesta y no la recalcula.
 */
function fakeBackend(nextResult: MoveResult, status = 200) {
  const moves: unknown[] = [];
  let robot: RobotSnapshot = { state: 'IDLE', position: { x: 120, y: 90 } };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, code = 200) =>
      new Response(JSON.stringify(body), {
        status: code,
        headers: { 'Content-Type': 'application/json' },
      });
    if (url.startsWith('/api/zones')) return json([stairs]);
    if (url === '/api/simulation/robot') return json(robot);
    if (url === '/api/simulation/move') {
      moves.push(JSON.parse(String(init?.body)));
      robot = {
        state: nextResult.state === 'MOVING' ? 'IDLE' : nextResult.state,
        position: nextResult.position,
      };
      return json(nextResult, status);
    }
    if (url === '/api/simulation/reset') {
      robot = { ...robot, state: 'IDLE' };
      return json(robot);
    }
    return json({ code: 'NOT_FOUND', message: 'x' }, 404);
  });
  return { fetchMock, moves };
}

const stop: MoveResult = {
  decision: 'PREVENTIVE_STOP',
  state: 'SAFE_STOP',
  position: { x: 120, y: 90 },
  collisionType: 'RESTRICTED_ZONE_VIOLATION',
  zoneName: 'Escaleras',
  reason: 'Destination is inside restricted zone: Escaleras',
};

/** Simula el tamaño del SVG en pantalla: 500×400 px desplazado (10, 20). */
function mockSvgBox() {
  const svg = screen.getByTestId('floor-plan');
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 500,
    height: 400,
    right: 510,
    bottom: 420,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  });
  return svg;
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /Solicitar movimiento/ }));

describe('clientToFloor (RF-01.1)', () => {
  it('convierte viewport → plano con escala uniforme y redondeo', () => {
    const box = { left: 10, top: 20, width: 500, height: 400 };
    expect(clientToFloor(60, 170, box)).toEqual({ x: 100, y: 300 });
    expect(clientToFloor(10, 20, box)).toEqual({ x: 0, y: 0 });
    expect(clientToFloor(60.2, 170.3, box)).toEqual({ x: 100, y: 301 });
  });

  it('sin tamaño en pantalla no produce punto', () => {
    expect(clientToFloor(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe('SimulationPage', () => {
  let backend: ReturnType<typeof fakeBackend>;
  afterEach(() => vi.unstubAllGlobals());

  describe('con respuesta PREVENTIVE_STOP', () => {
    beforeEach(() => {
      backend = fakeBackend(stop);
      vi.stubGlobal('fetch', backend.fetchMock);
    });

    it('pinta el robot en la posición que devuelve la API', async () => {
      render(<SimulationPage />);
      const robot = await screen.findByTestId('robot');
      expect(robot).toHaveAttribute('data-x', '120');
      expect(robot).toHaveAttribute('data-y', '90');
      expect(screen.getByTestId('robot-state')).toHaveTextContent('IDLE');
    });

    it('RF-01.1 el clic en el plano fija el destino y rellena las coordenadas', async () => {
      render(<SimulationPage />);
      await screen.findByTestId('robot');
      fireEvent.click(mockSvgBox(), { clientX: 60, clientY: 170 });
      expect(screen.getByLabelText('Destino X')).toHaveValue(100);
      expect(screen.getByLabelText('Destino Y')).toHaveValue(300);
      expect(screen.getByTestId('destination-marker')).toBeInTheDocument();
    });

    it('CA-03.7 clic y coordenadas producen la misma solicitud', async () => {
      const first = render(<SimulationPage />);
      await screen.findByTestId('robot');
      fireEvent.click(mockSvgBox(), { clientX: 60, clientY: 170 });
      await submit();
      await waitFor(() => expect(backend.moves).toHaveLength(1));
      first.unmount();

      render(<SimulationPage />);
      await screen.findByTestId('robot');
      await userEvent.type(screen.getByLabelText('Destino X'), '100');
      await userEvent.type(screen.getByLabelText('Destino Y'), '300');
      await submit();
      await waitFor(() => expect(backend.moves).toHaveLength(2));

      expect(backend.moves[0]).toEqual({ destination: { x: 100, y: 300 } });
      expect(backend.moves[1]).toEqual(backend.moves[0]);
    });

    it('CA-03.2 muestra la parada preventiva y el robot detenido', async () => {
      render(<SimulationPage />);
      await screen.findByTestId('robot');
      await userEvent.type(screen.getByLabelText('Destino X'), '100');
      await userEvent.type(screen.getByLabelText('Destino Y'), '300');
      await submit();
      expect(await screen.findByTestId('preventive-stop')).toHaveTextContent('Escaleras');
      await waitFor(() =>
        expect(screen.getByTestId('robot')).toHaveAttribute('data-state', 'SAFE_STOP'),
      );
      expect(screen.getByTestId('robot-state')).toHaveTextContent('SAFE_STOP');
    });

    it('DD-106 reset vuelve a IDLE', async () => {
      render(<SimulationPage />);
      await screen.findByTestId('robot');
      await userEvent.type(screen.getByLabelText('Destino X'), '100');
      await userEvent.type(screen.getByLabelText('Destino Y'), '300');
      await submit();
      await screen.findByTestId('preventive-stop');
      await userEvent.click(screen.getByRole('button', { name: /Liberar parada/ }));
      await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent('IDLE'));
      expect(screen.queryByTestId('preventive-stop')).not.toBeInTheDocument();
    });
  });

  it('CA-03.6 muestra la decisión de la API aunque la geometría local diga otra cosa', async () => {
    // Destino dentro de Escaleras, pero el servidor responde ALLOW: la UI no lo corrige.
    backend = fakeBackend({
      decision: 'ALLOW',
      state: 'MOVING',
      position: { x: 100, y: 300 },
      reason: 'Destination and trajectory are clear',
    });
    vi.stubGlobal('fetch', backend.fetchMock);
    render(<SimulationPage />);
    await screen.findByTestId('robot');
    await userEvent.type(screen.getByLabelText('Destino X'), '100');
    await userEvent.type(screen.getByLabelText('Destino Y'), '300');
    await submit();
    expect(await screen.findByTestId('decision')).toHaveTextContent('ALLOW');
    expect(screen.queryByTestId('preventive-stop')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('robot')).toHaveAttribute('data-x', '100'));
  });

  it('CA-03.4 muestra la denegación SAFE_STOP_ACTIVE de un 409', async () => {
    backend = fakeBackend(
      {
        decision: 'DENIED_SAFE_STOP',
        code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        position: { x: 120, y: 90 },
        reason: 'Robot is in SAFE_STOP; movement denied',
      },
      409,
    );
    vi.stubGlobal('fetch', backend.fetchMock);
    render(<SimulationPage />);
    await screen.findByTestId('robot');
    await userEvent.type(screen.getByLabelText('Destino X'), '450');
    await userEvent.type(screen.getByLabelText('Destino Y'), '120');
    await submit();
    expect(await screen.findByTestId('denied')).toHaveTextContent('SAFE_STOP_ACTIVE');
  });

  it('RF-04.5 muestra el error si la API falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/simulation/robot') throw new TypeError('offline');
        return new Response('[]', {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    render(<SimulationPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/NETWORK_ERROR/);
  });

  it('tarea 18: la inyección de fallos de sensor queda reservada y deshabilitada', async () => {
    backend = fakeBackend(stop);
    vi.stubGlobal('fetch', backend.fetchMock);
    render(<SimulationPage />);
    expect(screen.getByRole('button', { name: /fallo de sensor/ })).toBeDisabled();
    await screen.findByTestId('robot');
  });
});
