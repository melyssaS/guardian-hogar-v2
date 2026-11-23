import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientToFloor } from '../../src/components/FloorPlan';
import { SimulationPage } from '../../src/pages/SimulationPage';
import type {
  MoveResponse,
  PositionQuality,
  RecoverResponse,
  Robot,
  RobotStateName,
  Zone,
} from '../../src/types';

// Spec 003 — RC-12/RC-15 (RF-04, RF-10.2, RF-10.5..RF-10.7, RF-11.2, RF-11.3; CA-03.2, CA-03.4,
// CA-03.6, CA-03.7, CA-03.13, CA-03.14, CA-03.16, CA-03.30..CA-03.32).
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

const HOME = { x: 120, y: 90 };

const seedRobot = (over: Partial<Robot>): Robot => ({
  id: 1,
  name: 'Aspiradora A1',
  type: 'VACUUM',
  createdAt: '2025-01-01T00:00:00.000Z',
  state: 'IDLE',
  position: HOME,
  positionQuality: 'RELIABLE',
  lastRequest: null,
  ...over,
});

interface Call {
  path: string;
  body: unknown;
}

interface BackendOptions {
  /** Respuesta de `move` y su código HTTP. */
  move?: { body: unknown; status?: number; next?: { state: RobotStateName } };
  recover?: { body: unknown; status?: number; next?: { state: RobotStateName } };
  position?: { body: unknown; status?: number };
  robots?: Robot[];
}

/**
 * Backend falso: responde con lo configurado y registra los cuerpos de cada llamada. Así se
 * comprueba que la UI muestra la respuesta y no la recalcula.
 */
function fakeBackend(options: BackendOptions = {}) {
  const calls: Call[] = [];
  const robots = (
    options.robots ?? [
      seedRobot({}),
      seedRobot({ id: 2, name: 'Vigilante V2', type: 'GUARD', position: { x: 488, y: 290 } }),
    ]
  ).map((r) => ({ ...r }));
  const json = (body: unknown, code = 200) =>
    new Response(JSON.stringify(body), {
      status: code,
      headers: { 'Content-Type': 'application/json' },
    });
  const find = (id: number) => robots.find((r) => r.id === id);
  const apply = (id: number, patch: Partial<Robot>) => {
    const r = find(id);
    if (r) Object.assign(r, patch);
  };

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.startsWith('/api/zones')) return json([stairs]);
    if (url === '/api/robots') return json(robots);
    const m = /^\/api\/robots\/(\d+)\/(state|sessions|move|recover|position)$/.exec(url);
    if (!m) return json({ code: 'NOT_FOUND', message: 'x' }, 404);
    const id = Number(m[1]);
    const robot = find(id);
    if (!robot) return json({ code: 'ROBOT_NOT_FOUND', message: 'x' }, 404);
    if (m[2] !== 'state') calls.push({ path: url, body });
    switch (m[2]) {
      case 'state':
        return json({
          robotId: robot.id,
          state: robot.state,
          position: robot.position,
          positionQuality: robot.positionQuality,
          lastRequest: robot.lastRequest,
        });
      case 'sessions':
        return json({ sessionId: `session-${id}` }, 201);
      case 'move': {
        const spec = options.move;
        if (!spec) return json({ code: 'NOT_FOUND', message: 'x' }, 404);
        const res = spec.body as MoveResponse;
        apply(id, { state: res.state, position: res.position });
        return json(res, spec.status ?? 200);
      }
      case 'recover': {
        const spec = options.recover;
        if (!spec) return json({ code: 'NOT_FOUND', message: 'x' }, 404);
        if (spec.next) apply(id, spec.next);
        return json(spec.body, spec.status ?? 200);
      }
      default: {
        const spec = options.position;
        if (!spec) return json({ code: 'NOT_FOUND', message: 'x' }, 404);
        const res = spec.body as { state?: RobotStateName; positionQuality?: PositionQuality };
        if (spec.status === undefined || spec.status === 200) {
          apply(id, {
            ...(res.state ? { state: res.state } : {}),
            ...(res.positionQuality ? { positionQuality: res.positionQuality } : {}),
          });
        }
        return json(spec.body, spec.status ?? 200);
      }
    }
  });
  return { fetchMock, calls, robots };
}

const authorized = (position = { x: 450, y: 120 }): MoveResponse => ({
  decision: 'AUTHORIZED',
  state: 'IDLE',
  position,
  robotId: 1,
  positionQuality: 'RELIABLE',
});

const denied: MoveResponse = {
  decision: 'DENIED',
  code: 'RESTRICTED_ZONE_VIOLATION',
  state: 'SAFE_STOP',
  position: HOME,
  collisionType: 'RESTRICTED_ZONE_VIOLATION',
  incidentId: 5,
  rule: 'R-ZONA-01',
  zoneName: 'Escaleras',
  reason: 'Destination is inside restricted zone: Escaleras',
  robotId: 1,
  positionQuality: 'RELIABLE',
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

async function typeDestination(x: string, y: string) {
  await userEvent.type(screen.getByLabelText('Destino X'), x);
  await userEvent.type(screen.getByLabelText('Destino Y'), y);
}

const ready = () => screen.findByTestId('robot-1');

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
  const install = (options: BackendOptions = {}) => {
    backend = fakeBackend(options);
    vi.stubGlobal('fetch', backend.fetchMock);
  };
  afterEach(() => vi.unstubAllGlobals());

  describe('con respuesta DENIED', () => {
    beforeEach(() => install({ move: { body: denied } }));

    it('CA-03.16 pinta todos los robots del catálogo en la posición que devuelve la API', async () => {
      render(<SimulationPage />);
      const a1 = await ready();
      expect(a1).toHaveAttribute('data-x', '120');
      expect(a1).toHaveAttribute('data-y', '90');
      expect(await screen.findByTestId('robot-2')).toHaveAttribute('data-x', '488');
      expect(screen.getByTestId('robot-state')).toHaveTextContent('IDLE');
      expect(screen.getByTestId('robot-quality')).toHaveTextContent('RELIABLE');
    });

    it('RF-01.1 el clic en el plano fija el destino y rellena las coordenadas', async () => {
      render(<SimulationPage />);
      await ready();
      fireEvent.click(mockSvgBox(), { clientX: 60, clientY: 170 });
      expect(screen.getByLabelText('Destino X')).toHaveValue(100);
      expect(screen.getByLabelText('Destino Y')).toHaveValue(300);
      expect(screen.getByTestId('destination-marker')).toBeInTheDocument();
    });

    it('CA-03.7 clic y coordenadas producen el mismo cuerpo { destination, sessionId, sequence }', async () => {
      const first = render(<SimulationPage />);
      await ready();
      fireEvent.click(mockSvgBox(), { clientX: 60, clientY: 170 });
      await submit();
      await waitFor(() =>
        expect(backend.calls.filter((c) => c.path.endsWith('/move'))).toHaveLength(1),
      );
      first.unmount();

      render(<SimulationPage />);
      await ready();
      await typeDestination('100', '300');
      await submit();
      await waitFor(() =>
        expect(backend.calls.filter((c) => c.path.endsWith('/move'))).toHaveLength(2),
      );

      const moves = backend.calls.filter((c) => c.path.endsWith('/move'));
      expect(moves[0]?.path).toBe('/api/robots/1/move');
      expect(moves[0]?.body).toEqual({
        destination: { x: 100, y: 300 },
        sessionId: 'session-1',
        sequence: 1,
      });
      expect(moves[1]?.body).toEqual(moves[0]?.body);
    });

    it('CA-03.2 muestra la parada preventiva (code, zona e incidente) y el robot detenido', async () => {
      render(<SimulationPage />);
      await ready();
      await typeDestination('100', '300');
      await submit();
      const stop = await screen.findByTestId('preventive-stop');
      expect(stop).toHaveTextContent('RESTRICTED_ZONE_VIOLATION');
      expect(stop).toHaveTextContent('Escaleras');
      expect(stop).toHaveTextContent('Incidente #5');
      await waitFor(() =>
        expect(screen.getByTestId('robot-1')).toHaveAttribute('data-state', 'SAFE_STOP'),
      );
      expect(screen.getByTestId('robot-state')).toHaveTextContent('SAFE_STOP');
    });
  });

  it('CA-03.6 muestra la decisión de la API aunque la geometría local diga otra cosa', async () => {
    // Destino dentro de Escaleras, pero el servidor responde AUTHORIZED: la UI no lo corrige.
    install({ move: { body: authorized({ x: 100, y: 300 }) } });
    render(<SimulationPage />);
    await ready();
    await typeDestination('100', '300');
    await submit();
    expect(await screen.findByTestId('decision')).toHaveTextContent('AUTHORIZED');
    expect(screen.queryByTestId('preventive-stop')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('robot-1')).toHaveAttribute('data-x', '100'));
  });

  it.each(['SAFE_STOP_ACTIVE', 'BUSY'] as const)(
    'CA-03.4 muestra el rechazo %s de un 409 tal como llega',
    async (code) => {
      install({
        move: {
          status: 409,
          body: {
            decision: 'REJECTED',
            code,
            state: code === 'BUSY' ? 'MOVING' : 'SAFE_STOP',
            position: HOME,
            reason: `Rejected: ${code}`,
            robotId: 1,
            positionQuality: 'RELIABLE',
          } satisfies MoveResponse,
        },
      });
      render(<SimulationPage />);
      await ready();
      await typeDestination('450', '120');
      await submit();
      const rejected = await screen.findByTestId('rejected');
      expect(rejected).toHaveTextContent(code);
      expect(screen.queryByTestId('preventive-stop')).not.toBeInTheDocument();
    },
  );

  it('un 409 DUPLICATE_EVENT se muestra como aviso con su código, sin decisión', async () => {
    install({
      move: { status: 409, body: { code: 'DUPLICATE_EVENT', message: 'Secuencia repetida' } },
    });
    render(<SimulationPage />);
    await ready();
    await typeDestination('450', '120');
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('DUPLICATE_EVENT');
    expect(screen.queryByTestId('decision')).not.toBeInTheDocument();
  });

  describe('liberar parada (recover)', () => {
    const stoppedA1 = [seedRobot({ state: 'SAFE_STOP' })];

    it('CA-03.13 transitioned=true muestra "Parada liberada" y el robot queda en IDLE', async () => {
      const recovered: RecoverResponse = {
        robotId: 1,
        state: 'IDLE',
        position: HOME,
        positionQuality: 'RELIABLE',
        transitioned: true,
      };
      install({ robots: stoppedA1, recover: { body: recovered, next: { state: 'IDLE' } } });
      render(<SimulationPage />);
      await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent('SAFE_STOP'));
      await userEvent.click(screen.getByRole('button', { name: /Liberar parada/ }));
      expect(await screen.findByRole('status')).toHaveTextContent('Parada liberada');
      await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent('IDLE'));
      expect(backend.calls.some((c) => c.path === '/api/robots/1/recover')).toBe(true);
    });

    it('CA-03.13 transitioned=false muestra "El robot ya estaba en IDLE", no "Parada liberada"', async () => {
      install({
        robots: [seedRobot({})],
        recover: {
          body: {
            robotId: 1,
            state: 'IDLE',
            position: HOME,
            positionQuality: 'RELIABLE',
            transitioned: false,
          } satisfies RecoverResponse,
        },
      });
      render(<SimulationPage />);
      await ready();
      await userEvent.click(screen.getByRole('button', { name: /Liberar parada/ }));
      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent('El robot ya estaba en IDLE');
      expect(status).not.toHaveTextContent('Parada liberada');
    });

    it('CA-03.14 409 RECOVERY_NOT_ALLOWED muestra la causa y el robot sigue en parada', async () => {
      install({
        robots: stoppedA1,
        recover: {
          status: 409,
          body: {
            code: 'RECOVERY_NOT_ALLOWED',
            message: 'Recuperación no permitida',
            cause: 'UNSAFE_POSITION',
          },
        },
      });
      render(<SimulationPage />);
      await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent('SAFE_STOP'));
      await userEvent.click(screen.getByRole('button', { name: /Liberar parada/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('UNSAFE_POSITION');
      expect(screen.getByTestId('robot-state')).toHaveTextContent('SAFE_STOP');
      expect(screen.queryByText(/Parada liberada/)).not.toBeInTheDocument();
    });
  });

  describe('estados y calidad de posición (RF-04.6)', () => {
    it('CA-03.30 DEGRADED + MISSING se muestra tal cual y el robot se pinta en gris', async () => {
      install({ robots: [seedRobot({ state: 'DEGRADED', positionQuality: 'MISSING' })] });
      render(<SimulationPage />);
      await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent('DEGRADED'));
      expect(screen.getByTestId('robot-quality')).toHaveTextContent('MISSING');
      const circle = screen.getByTestId('robot-1').querySelectorAll('circle')[1];
      expect(circle).toHaveAttribute('fill', '#8893a2');
    });

    it.each(['IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING'] as const)(
      'muestra el estado %s que devuelve la API',
      async (state) => {
        install({ robots: [seedRobot({ state })] });
        render(<SimulationPage />);
        await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent(state));
        expect(screen.getByTestId('robot-1')).toHaveAttribute('data-state', state);
      },
    );
  });

  describe('señal de posición (Q-B)', () => {
    it('CA-03.31 "Perder conexión" envía MISSING con la posición de la API y muestra DEGRADED', async () => {
      install({
        position: { body: { state: 'DEGRADED', position: HOME, positionQuality: 'MISSING' } },
      });
      render(<SimulationPage />);
      await ready();
      await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent('IDLE'));
      await userEvent.click(screen.getByRole('button', { name: /Perder conexión/ }));
      await waitFor(() => expect(screen.getByTestId('robot-state')).toHaveTextContent('DEGRADED'));
      expect(screen.getByTestId('robot-quality')).toHaveTextContent('MISSING');
      expect(backend.calls.find((c) => c.path === '/api/robots/1/position')?.body).toEqual({
        position: HOME,
        quality: 'MISSING',
      });
    });

    it('CA-03.32 "Recuperar señal" envía RELIABLE con la posición de la API', async () => {
      install({
        robots: [seedRobot({ state: 'DEGRADED', positionQuality: 'MISSING' })],
        position: { body: { state: 'DEGRADED', position: HOME, positionQuality: 'RELIABLE' } },
      });
      render(<SimulationPage />);
      await waitFor(() => expect(screen.getByTestId('robot-quality')).toHaveTextContent('MISSING'));
      await userEvent.click(screen.getByRole('button', { name: /Recuperar señal/ }));
      await waitFor(() =>
        expect(screen.getByTestId('robot-quality')).toHaveTextContent('RELIABLE'),
      );
      expect(backend.calls.find((c) => c.path === '/api/robots/1/position')?.body).toEqual({
        position: HOME,
        quality: 'RELIABLE',
      });
    });

    it('muestra tal cual el 409 POSITION_CONFLICT de "Recuperar señal"', async () => {
      install({
        robots: [seedRobot({ state: 'DEGRADED', positionQuality: 'MISSING' })],
        position: {
          status: 409,
          body: { code: 'POSITION_CONFLICT', message: 'La lectura no coincide' },
        },
      });
      render(<SimulationPage />);
      await waitFor(() => expect(screen.getByTestId('robot-quality')).toHaveTextContent('MISSING'));
      await userEvent.click(screen.getByRole('button', { name: /Recuperar señal/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent('POSITION_CONFLICT');
      expect(screen.getByTestId('robot-quality')).toHaveTextContent('MISSING');
    });
  });

  it('CA-03.16 el selector aplica clic, coordenadas y "Liberar parada" al robot elegido', async () => {
    install({
      move: {
        body: {
          ...authorized({ x: 450, y: 120 }),
          robotId: 2,
        } satisfies MoveResponse,
      },
      recover: {
        body: {
          robotId: 2,
          state: 'IDLE',
          position: { x: 488, y: 290 },
          positionQuality: 'RELIABLE',
          transitioned: false,
        } satisfies RecoverResponse,
      },
    });
    render(<SimulationPage />);
    await ready();
    expect(screen.getByLabelText('Elegir robot')).toHaveValue('1');
    await userEvent.selectOptions(screen.getByLabelText('Elegir robot'), '2');
    await waitFor(() =>
      expect(screen.getByTestId('robot-position')).toHaveTextContent('(488, 290)'),
    );

    await typeDestination('450', '120');
    await submit();
    await waitFor(() =>
      expect(backend.calls.some((c) => c.path === '/api/robots/2/move')).toBe(true),
    );
    expect(backend.calls.some((c) => c.path === '/api/robots/1/move')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: /Liberar parada/ }));
    await waitFor(() =>
      expect(backend.calls.some((c) => c.path === '/api/robots/2/recover')).toBe(true),
    );
  });

  it('RF-04.5 muestra el error si la API falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/robots/1/state')) throw new TypeError('offline');
        return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      }),
    );
    render(<SimulationPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/NETWORK_ERROR/);
  });

  it('tarea 18: la inyección de fallos de sensor queda reservada y deshabilitada', async () => {
    install();
    render(<SimulationPage />);
    expect(screen.getByRole('button', { name: /fallo de sensor/ })).toBeDisabled();
    await ready();
  });
});
