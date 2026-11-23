import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, incidentsApi, robotsApi, type RobotsApi } from '../../src/api/client';
import { useRobot } from '../../src/hooks/useRobot';
import { useRobots } from '../../src/hooks/useRobots';
import type {
  Incident,
  MoveResponse,
  PositionResponse,
  RecoverResponse,
  Robot,
  RobotStatus,
} from '../../src/types';

// Spec 003 — RC-13 (RF-04.5, RF-08.6, RF-10.6, RF-10.7, RF-11.2, RF-11.3; CA-03.13, CA-03.14,
// CA-03.23, CA-03.31, CA-03.32): `robotsApi`, `incidentsApi` y los hooks `useRobot` / `useRobots`
// contra /api/robots/:robotId/*. La UI no decide: solo pide, guarda y muestra las respuestas.

const HOME = { x: 120, y: 90 };
const FREE = { x: 450, y: 120 };
const S1 = '5f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const S2 = '6a2d3c4b-5e6f-4071-9b8c-0d1e2f3a4b5c';

const status = (over: Partial<RobotStatus> = {}): RobotStatus => ({
  robotId: 1,
  state: 'IDLE',
  position: HOME,
  positionQuality: 'RELIABLE',
  lastRequest: null,
  ...over,
});

const authorized = (position = FREE): MoveResponse => ({
  decision: 'AUTHORIZED',
  state: 'IDLE',
  position,
  robotId: 1,
  positionQuality: 'RELIABLE',
});

function fakeApi(overrides: Partial<RobotsApi> = {}): RobotsApi {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    register: vi.fn(),
    getState: vi.fn().mockResolvedValue(status()),
    startSession: vi
      .fn()
      .mockResolvedValueOnce({ sessionId: S1 })
      .mockResolvedValue({ sessionId: S2 }),
    move: vi.fn().mockResolvedValue(authorized()),
    recover: vi.fn(),
    sendPosition: vi.fn(),
    ...overrides,
  };
}

describe('useRobot', () => {
  it('carga el estado del robot al montar (con lastRequest) usando su robotId', async () => {
    const lastRequest = {
      sessionId: S1,
      sequence: 4,
      destination: FREE,
      acceptedAt: '2026-01-01T00:00:00.000Z',
    };
    const api = fakeApi({
      getState: vi.fn().mockResolvedValue(status({ robotId: 2, lastRequest })),
    });
    const { result } = renderHook(() => useRobot(2, api));
    expect(result.current.status.robot.loading).toBe(true);
    await waitFor(() => expect(result.current.status.robot.loading).toBe(false));
    expect(api.getState).toHaveBeenCalledWith(2);
    expect(result.current.robot).toEqual(status({ robotId: 2, lastRequest }));
  });

  it('expone el error de carga del estado', async () => {
    const api = fakeApi({
      getState: vi
        .fn()
        .mockRejectedValue(new ApiError(404, 'ROBOT_NOT_FOUND', 'Robot 9 not found')),
    });
    const { result } = renderHook(() => useRobot(9, api));
    await waitFor(() =>
      expect(result.current.status.robot.error).toBe('Robot 9 not found (ROBOT_NOT_FOUND)'),
    );
  });

  describe('move con sesión y secuencia automáticas (CA-03.23, RF-08.6)', () => {
    it('inicia la sesión en el primer movimiento y envía sequence 1, 2 y 3 sin que el operador las escriba', async () => {
      const api = fakeApi();
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());

      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          await result.current.move(FREE);
        });
      }

      expect(api.startSession).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(api.move).mock.calls.map(([id, cmd]) => [id, cmd.sessionId, cmd.sequence]),
      ).toEqual([
        [1, S1, 1],
        [1, S1, 2],
        [1, S1, 3],
      ]);
      expect(vi.mocked(api.move).mock.calls[0]?.[1].destination).toEqual(FREE);
    });

    it('"Nueva sesión" cambia el sessionId y reinicia el contador a 1', async () => {
      const api = fakeApi();
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());
      await act(async () => {
        await result.current.move(FREE);
        await result.current.move(FREE);
      });
      await act(async () => {
        expect(await result.current.startSession()).toBe(S2);
      });
      await act(async () => {
        await result.current.move(FREE);
      });
      const last = vi.mocked(api.move).mock.calls.at(-1)?.[1];
      expect(last).toMatchObject({ sessionId: S2, sequence: 1 });
    });

    it('guarda la sesión y el contador por robot: al volver a un robot sigue con su secuencia', async () => {
      const api = fakeApi({
        startSession: vi
          .fn()
          .mockResolvedValueOnce({ sessionId: S1 })
          .mockResolvedValueOnce({ sessionId: S2 }),
      });
      const { result, rerender } = renderHook(({ id }) => useRobot(id, api), {
        initialProps: { id: 1 },
      });
      await waitFor(() => expect(result.current.robot).not.toBeNull());
      await act(async () => {
        await result.current.move(FREE); // robot 1, sequence 1
      });
      rerender({ id: 2 });
      await waitFor(() => expect(api.getState).toHaveBeenLastCalledWith(2));
      await act(async () => {
        await result.current.move(FREE); // robot 2, sesión propia, sequence 1
      });
      rerender({ id: 1 });
      await waitFor(() => expect(api.getState).toHaveBeenLastCalledWith(1));
      await act(async () => {
        await result.current.move(FREE); // robot 1, misma sesión, sequence 2
      });
      expect(
        vi.mocked(api.move).mock.calls.map(([id, cmd]) => [id, cmd.sessionId, cmd.sequence]),
      ).toEqual([
        [1, S1, 1],
        [2, S2, 1],
        [1, S1, 2],
      ]);
    });

    it('guarda la decisión tal como llega y refresca el estado desde el servidor', async () => {
      const denied: MoveResponse = {
        decision: 'DENIED',
        code: 'RESTRICTED_ZONE_VIOLATION',
        state: 'SAFE_STOP',
        position: HOME,
        collisionType: 'RESTRICTED_ZONE_VIOLATION',
        incidentId: 7,
        rule: 'R-ZONA-01',
        zoneName: 'Escaleras',
        reason: 'Destination is inside restricted zone',
        robotId: 1,
        positionQuality: 'RELIABLE',
      };
      const api = fakeApi({ move: vi.fn().mockResolvedValue(denied) });
      vi.mocked(api.getState)
        .mockResolvedValueOnce(status())
        .mockResolvedValueOnce(status({ state: 'SAFE_STOP' }));
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());

      await act(async () => {
        expect(await result.current.move({ x: 100, y: 300 })).toEqual(denied);
      });
      expect(result.current.lastResult).toEqual(denied);
      expect(result.current.robot?.state).toBe('SAFE_STOP');
    });

    it('un REJECTED (409 con decisión) se guarda como decisión, no como error', async () => {
      const rejected: MoveResponse = {
        decision: 'REJECTED',
        code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        position: HOME,
        reason: 'Robot is not in a movable state; movement rejected',
        robotId: 1,
        positionQuality: 'RELIABLE',
      };
      const api = fakeApi({ move: vi.fn().mockResolvedValue(rejected) });
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());
      await act(async () => {
        await result.current.move(FREE);
      });
      expect(result.current.lastResult).toEqual(rejected);
      expect(result.current.status.move.error).toBeNull();
    });

    it.each([
      ['DUPLICATE_EVENT', 'Sequence 1 was already processed for this session'],
      ['INVALID_SESSION', 'Session is not the current session of this robot'],
    ])('muestra tal cual el 409 %s como error de la operación', async (code, message) => {
      const api = fakeApi({ move: vi.fn().mockRejectedValue(new ApiError(409, code, message)) });
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());
      await act(async () => {
        expect(await result.current.move(FREE)).toBeNull();
      });
      expect(result.current.status.move).toEqual({ loading: false, error: `${message} (${code})` });
    });

    it('un fallo al iniciar la sesión se muestra y no envía el movimiento', async () => {
      const api = fakeApi({
        startSession: vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Sin conexión')),
      });
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());
      await act(async () => {
        expect(await result.current.move(FREE)).toBeNull();
      });
      expect(api.move).not.toHaveBeenCalled();
      expect(result.current.status.move.error).toBe('Sin conexión (NETWORK_ERROR)');
    });
  });

  describe('recover (CA-03.13, CA-03.14, RF-11.2, RF-11.3)', () => {
    const recovered = (transitioned: boolean): RecoverResponse => ({
      robotId: 1,
      state: 'IDLE',
      position: HOME,
      positionQuality: 'RELIABLE',
      transitioned,
    });

    it.each([true, false])(
      'guarda la respuesta con transitioned %s y refresca el estado',
      async (transitioned) => {
        const api = fakeApi({ recover: vi.fn().mockResolvedValue(recovered(transitioned)) });
        const { result } = renderHook(() => useRobot(1, api));
        await waitFor(() => expect(result.current.robot).not.toBeNull());
        await act(async () => {
          expect(await result.current.recover()).toEqual(recovered(transitioned));
        });
        expect(api.recover).toHaveBeenCalledWith(1);
        expect(result.current.lastRecover).toEqual(recovered(transitioned));
        expect(api.getState).toHaveBeenCalledTimes(2);
      },
    );

    it('409 RECOVERY_NOT_ALLOWED muestra la cause y el robot sigue en parada', async () => {
      const api = fakeApi({
        recover: vi.fn().mockRejectedValue(
          new ApiError(
            409,
            'RECOVERY_NOT_ALLOWED',
            'Current position is inside a restricted zone',
            {
              code: 'RECOVERY_NOT_ALLOWED',
              cause: 'UNSAFE_POSITION',
              message: 'Current position is inside a restricted zone',
            },
          ),
        ),
        getState: vi.fn().mockResolvedValue(status({ state: 'SAFE_STOP' })),
      });
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());
      await act(async () => {
        expect(await result.current.recover()).toBeNull();
      });
      expect(result.current.status.recover.error).toBe(
        'Current position is inside a restricted zone (RECOVERY_NOT_ALLOWED: UNSAFE_POSITION)',
      );
      expect(result.current.lastRecover).toBeNull();
      expect(result.current.robot?.state).toBe('SAFE_STOP');
    });
  });

  describe('señal de posición (CA-03.31, CA-03.32, Q-B)', () => {
    const lost = (quality: 'MISSING' | 'RELIABLE'): PositionResponse => ({
      state: quality === 'MISSING' ? 'DEGRADED' : 'DEGRADED',
      position: HOME,
      positionQuality: quality,
    });

    it('"Perder conexión" envía quality MISSING con la posición que devolvió la API y refresca', async () => {
      const api = fakeApi({ sendPosition: vi.fn().mockResolvedValue(lost('MISSING')) });
      vi.mocked(api.getState)
        .mockResolvedValueOnce(status())
        .mockResolvedValueOnce(status({ state: 'DEGRADED', positionQuality: 'MISSING' }));
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());

      await act(async () => {
        await result.current.loseSignal();
      });

      expect(api.sendPosition).toHaveBeenCalledWith(1, { position: HOME, quality: 'MISSING' });
      expect(result.current.robot).toMatchObject({ state: 'DEGRADED', positionQuality: 'MISSING' });
    });

    it('"Recuperar señal" envía RELIABLE con la posición del último estado, sin calcularla', async () => {
      const degraded = status({
        state: 'DEGRADED',
        positionQuality: 'MISSING',
        position: { x: 33.5, y: 77 },
      });
      const api = fakeApi({
        getState: vi.fn().mockResolvedValue(degraded),
        sendPosition: vi.fn().mockResolvedValue(lost('RELIABLE')),
      });
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());

      await act(async () => {
        await result.current.restoreSignal();
      });
      expect(api.sendPosition).toHaveBeenCalledWith(1, {
        position: { x: 33.5, y: 77 },
        quality: 'RELIABLE',
      });
    });

    it('muestra POSITION_CONFLICT tal cual si la API lo devuelve', async () => {
      const api = fakeApi({
        sendPosition: vi
          .fn()
          .mockRejectedValue(
            new ApiError(
              409,
              'POSITION_CONFLICT',
              'Reliable reading does not match the current position',
            ),
          ),
      });
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.robot).not.toBeNull());
      await act(async () => {
        expect(await result.current.restoreSignal()).toBeNull();
      });
      expect(result.current.status.signal.error).toBe(
        'Reliable reading does not match the current position (POSITION_CONFLICT)',
      );
    });

    it('sin estado cargado no envía nada (la posición la da la API, no la UI)', async () => {
      const api = fakeApi({
        getState: vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Sin conexión')),
      });
      const { result } = renderHook(() => useRobot(1, api));
      await waitFor(() => expect(result.current.status.robot.loading).toBe(false));
      await act(async () => {
        expect(await result.current.loseSignal()).toBeNull();
        expect(await result.current.restoreSignal()).toBeNull();
      });
      expect(api.sendPosition).not.toHaveBeenCalled();
    });
  });
});

describe('useRobots', () => {
  const robot = (id: number, name: string): Robot => ({
    id,
    name,
    type: 'VACUUM',
    createdAt: '2026-01-01T00:00:00.000Z',
    state: 'IDLE',
    position: HOME,
    positionQuality: 'RELIABLE',
    lastRequest: null,
  });

  it('carga la lista al montar con carga/error por operación', async () => {
    const api = fakeApi({ list: vi.fn().mockResolvedValue([robot(1, 'A1'), robot(2, 'V2')]) });
    const { result } = renderHook(() => useRobots(api));
    expect(result.current.status.list.loading).toBe(true);
    await waitFor(() => expect(result.current.status.list.loading).toBe(false));
    expect(result.current.robots.map((r) => r.name)).toEqual(['A1', 'V2']);
  });

  it('register añade el robot y vuelve a pedir la lista', async () => {
    const created = robot(3, 'Nuevo');
    const api = fakeApi({
      list: vi
        .fn()
        .mockResolvedValueOnce([robot(1, 'A1')])
        .mockResolvedValueOnce([robot(1, 'A1'), created]),
      register: vi.fn().mockResolvedValue(created),
    });
    const { result } = renderHook(() => useRobots(api));
    await waitFor(() => expect(result.current.robots).toHaveLength(1));
    await act(async () => {
      expect(await result.current.register({ name: 'Nuevo', type: 'VACUUM' })).toEqual(created);
    });
    expect(api.register).toHaveBeenCalledWith({ name: 'Nuevo', type: 'VACUUM' });
    expect(result.current.robots.map((r) => r.name)).toEqual(['A1', 'Nuevo']);
  });

  it.each([
    [new ApiError(422, 'INVALID_ROBOT', 'name: too short'), 'name: too short (INVALID_ROBOT)'],
    [
      new ApiError(409, 'ROBOT_NAME_DUPLICATE', 'Robot name "A1" already exists'),
      'Robot name "A1" already exists (ROBOT_NAME_DUPLICATE)',
    ],
    [
      new ApiError(
        409,
        'ROBOT_START_IN_RESTRICTED_ZONE',
        'Start position is inside a restricted zone',
      ),
      'Start position is inside a restricted zone (ROBOT_START_IN_RESTRICTED_ZONE)',
    ],
    [
      new ApiError(409, 'ROBOT_START_NOT_VERIFIABLE', 'Zone data is unavailable', {
        code: 'ROBOT_START_NOT_VERIFIABLE',
        cause: 'ZONE_DATA_UNAVAILABLE',
        message: 'Zone data is unavailable',
      }),
      'Zone data is unavailable (ROBOT_START_NOT_VERIFIABLE: ZONE_DATA_UNAVAILABLE)',
    ],
  ])('un alta rechazada muestra el código de la API sin crear el robot', async (error, message) => {
    const api = fakeApi({ register: vi.fn().mockRejectedValue(error) });
    const { result } = renderHook(() => useRobots(api));
    await waitFor(() => expect(result.current.status.list.loading).toBe(false));
    await act(async () => {
      expect(await result.current.register({ name: 'X', type: 'GUARD' })).toBeNull();
    });
    expect(result.current.status.register.error).toBe(message);
    expect(result.current.robots).toEqual([]);
  });
});

describe('robotsApi e incidentsApi (HTTP)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, status: number) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  const lastCall = () => {
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
  };

  it('list / get / register usan /api/robots', async () => {
    respond([], 200);
    await robotsApi.list();
    expect(lastCall()).toEqual({ url: '/api/robots', method: 'GET', body: undefined });
    respond(status(), 200);
    await robotsApi.get(2);
    expect(lastCall().url).toBe('/api/robots/2');
    respond({}, 201);
    await robotsApi.register({ name: 'N', type: 'GUARD' });
    expect(lastCall()).toEqual({
      url: '/api/robots',
      method: 'POST',
      body: { name: 'N', type: 'GUARD' },
    });
  });

  it('getState y startSession usan las rutas por robot', async () => {
    respond(status(), 200);
    await robotsApi.getState(3);
    expect(lastCall()).toMatchObject({ url: '/api/robots/3/state', method: 'GET' });
    respond({ sessionId: S1 }, 201);
    await expect(robotsApi.startSession(3)).resolves.toEqual({ sessionId: S1 });
    expect(lastCall()).toMatchObject({ url: '/api/robots/3/sessions', method: 'POST' });
  });

  it('move envía destino, sesión y secuencia al robot indicado', async () => {
    respond(authorized(), 200);
    await robotsApi.move(2, { destination: FREE, sessionId: S1, sequence: 5 });
    expect(lastCall()).toEqual({
      url: '/api/robots/2/move',
      method: 'POST',
      body: { destination: FREE, sessionId: S1, sequence: 5 },
    });
  });

  it('un 409 REJECTED con cuerpo de decisión se devuelve como decisión (DD-102)', async () => {
    const rejected = {
      decision: 'REJECTED',
      code: 'BUSY',
      state: 'MOVING',
      position: HOME,
      reason: 'x',
      robotId: 1,
      positionQuality: 'RELIABLE',
    };
    respond(rejected, 409);
    await expect(
      robotsApi.move(1, { destination: FREE, sessionId: S1, sequence: 1 }),
    ).resolves.toEqual(rejected);
  });

  it('un 409 { code, message } (DUPLICATE_EVENT) se propaga como ApiError con su código', async () => {
    respond({ code: 'DUPLICATE_EVENT', message: 'dup' }, 409);
    await expect(
      robotsApi.move(1, { destination: FREE, sessionId: S1, sequence: 1 }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_EVENT',
    });
  });

  it('recover llama a POST /recover y un 409 conserva el cuerpo con la cause', async () => {
    respond({ code: 'RECOVERY_NOT_ALLOWED', cause: 'UNSAFE_POSITION', message: 'm' }, 409);
    await expect(robotsApi.recover(1)).rejects.toMatchObject({
      status: 409,
      code: 'RECOVERY_NOT_ALLOWED',
      body: { cause: 'UNSAFE_POSITION' },
    });
    expect(lastCall()).toMatchObject({ url: '/api/robots/1/recover', method: 'POST' });
  });

  it('sendPosition envía la lectura a /position', async () => {
    respond({ state: 'DEGRADED', position: HOME, positionQuality: 'MISSING' }, 200);
    await robotsApi.sendPosition(1, { position: HOME, quality: 'MISSING' });
    expect(lastCall()).toEqual({
      url: '/api/robots/1/position',
      method: 'POST',
      body: { position: HOME, quality: 'MISSING' },
    });
  });

  it('incidentsApi: list con y sin ?robotId= y get por id', async () => {
    const incident = { id: 1 } as unknown as Incident;
    respond([incident], 200);
    await incidentsApi.list();
    expect(lastCall().url).toBe('/api/incidents');
    respond([incident], 200);
    await incidentsApi.list(2);
    expect(lastCall().url).toBe('/api/incidents?robotId=2');
    respond({ ...incident, zonesSnapshot: [] }, 200);
    await incidentsApi.get(7);
    expect(lastCall().url).toBe('/api/incidents/7');
  });
});
