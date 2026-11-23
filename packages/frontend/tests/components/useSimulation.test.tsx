import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, simulationApi, type SimulationApi } from '../../src/api/client';
import { useSimulation } from '../../src/hooks/useSimulation';
import type { MoveResult } from '../../src/types';

// Spec 003 — tareas 12 y 13 (RF-04.4, RF-04.5)
const allow: MoveResult = {
  decision: 'ALLOW',
  state: 'MOVING',
  position: { x: 450, y: 120 },
  reason: 'Destination and trajectory are clear',
};

function fakeApi(overrides: Partial<SimulationApi> = {}): SimulationApi {
  return {
    getRobot: vi.fn().mockResolvedValue({ state: 'IDLE', position: { x: 120, y: 90 } }),
    move: vi.fn().mockResolvedValue(allow),
    reset: vi.fn().mockResolvedValue({ state: 'IDLE', position: { x: 120, y: 90 } }),
    ...overrides,
  };
}

describe('useSimulation', () => {
  it('carga el robot al montar (estado de carga → listo)', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useSimulation(api));
    expect(result.current.status.robot.loading).toBe(true);
    await waitFor(() => expect(result.current.status.robot.loading).toBe(false));
    expect(result.current.robot).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
    });
  });

  it('RF-04.4 tras mover guarda la decisión y refresca el robot desde el servidor', async () => {
    const api = fakeApi();
    vi.mocked(api.getRobot)
      .mockResolvedValueOnce({ state: 'IDLE', position: { x: 120, y: 90 } })
      .mockResolvedValueOnce({ state: 'IDLE', position: { x: 450, y: 120 } });
    const { result } = renderHook(() => useSimulation(api));
    await waitFor(() => expect(result.current.robot).not.toBeNull());

    await act(async () => {
      expect(await result.current.move({ x: 450, y: 120 })).toEqual(allow);
    });
    expect(api.move).toHaveBeenCalledWith({ x: 450, y: 120 });
    expect(result.current.lastResult).toEqual(allow);
    expect(result.current.robot).toEqual({
      state: 'IDLE',
      position: { x: 450, y: 120 },
    });
  });

  it('RF-04.5 expone el error de la operación move', async () => {
    const api = fakeApi({
      move: vi
        .fn()
        .mockRejectedValue(
          new ApiError(422, 'DESTINATION_OUT_OF_BOUNDS', 'Destination outside floor'),
        ),
    });
    const { result } = renderHook(() => useSimulation(api));
    await waitFor(() => expect(result.current.robot).not.toBeNull());
    await act(async () => {
      expect(await result.current.move({ x: 5000, y: 0 })).toBeNull();
    });
    expect(result.current.status.move).toEqual({
      loading: false,
      error: 'Destination outside floor (DESTINATION_OUT_OF_BOUNDS)',
    });
  });

  it('reset deja el robot devuelto por la API y limpia la decisión', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useSimulation(api));
    await waitFor(() => expect(result.current.robot).not.toBeNull());
    await act(async () => {
      await result.current.move({ x: 450, y: 120 });
      await result.current.reset();
    });
    expect(result.current.lastResult).toBeNull();
    expect(result.current.robot?.state).toBe('IDLE');
  });

  it('expone el error de carga del robot', async () => {
    const api = fakeApi({
      getRobot: vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Sin conexión')),
    });
    const { result } = renderHook(() => useSimulation(api));
    await waitFor(() =>
      expect(result.current.status.robot.error).toBe('Sin conexión (NETWORK_ERROR)'),
    );
  });
});

describe('simulationApi.move', () => {
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

  it('envía solo el destino', async () => {
    respond(allow, 200);
    await simulationApi.move({ x: 1, y: 2 });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/simulation/move');
    expect(JSON.parse(String(init.body))).toEqual({
      destination: { x: 1, y: 2 },
    });
  });

  it('DD-102 un 409 DENIED_SAFE_STOP se devuelve como decisión', async () => {
    const denied: MoveResult = {
      decision: 'DENIED_SAFE_STOP',
      code: 'SAFE_STOP_ACTIVE',
      state: 'SAFE_STOP',
      position: { x: 120, y: 90 },
      reason: 'Robot is in SAFE_STOP; movement denied',
    };
    respond(denied, 409);
    await expect(simulationApi.move({ x: 1, y: 2 })).resolves.toEqual(denied);
  });

  it('un 422 se propaga como ApiError con su código', async () => {
    respond(
      {
        code: 'DESTINATION_OUT_OF_BOUNDS',
        message: 'Destination outside floor',
      },
      422,
    );
    await expect(simulationApi.move({ x: -1, y: 2 })).rejects.toMatchObject({
      status: 422,
      code: 'DESTINATION_OUT_OF_BOUNDS',
    });
  });
});
