import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, incidentsApi, type IncidentsApi } from '../../src/api/client';
import { useIncidents } from '../../src/hooks/useIncidents';
import type { Incident } from '../../src/types';

// Spec 006 — HU-06, tarea 9 (CA-06.2, CA-06.8, CA-06.9): cliente HTTP y hook con filtro.
const make = (id: number, severity: Incident['severity']): Incident => ({
  id,
  robotId: 1,
  robotName: 'Aspiradora A1',
  rule: 'R-ZONA-01',
  zoneName: null,
  decisionCode: 'RESTRICTED_ZONE_VIOLATION',
  severity,
  collisionType: null,
  stateAfter: 'SAFE_STOP',
  origin: { x: 0, y: 0 },
  destination: { x: 0, y: 0 },
  reason: 'x',
  createdAt: '2025-01-01T00:00:00.000Z',
});

const ALL = [make(3, 'HIGH'), make(2, 'LOW'), make(1, 'HIGH')];
const HIGH = [make(3, 'HIGH'), make(1, 'HIGH')];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fakeApi = (list: IncidentsApi['list']): IncidentsApi => ({
  list,
  get: vi.fn(),
  exportCsv: vi.fn(),
});

describe('incidentsApi.list (URL)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('arma la URL con robotId y/o severity y, sin filtros, pide exactamente /api/incidents', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await incidentsApi.list();
    await incidentsApi.list(2);
    await incidentsApi.list(undefined, 'HIGH');
    await incidentsApi.list(2, 'CRITICAL');

    const urls = (fetchMock.mock.calls as unknown as [string][]).map((c) => c[0]);
    expect(urls).toEqual([
      '/api/incidents',
      '/api/incidents?robotId=2',
      '/api/incidents?severity=HIGH',
      '/api/incidents?robotId=2&severity=CRITICAL',
    ]);
  });
});

describe('useIncidents con filtro de severidad', () => {
  it('CA-06.9 sin filtro pide la lista sin argumentos (SimulationPage no cambia)', async () => {
    const list = vi.fn(async () => ALL);
    const api = fakeApi(list);
    const { result } = renderHook(() => useIncidents(api));
    await waitFor(() => expect(result.current.incidents).toEqual(ALL));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith();
    expect(result.current.severity).toBeNull();
    expect(result.current.activeSeverity).toBeNull();
  });

  it('CA-06.2 setSeverity pide ?severity= y resetSeverity vuelve a pedir sin parámetro', async () => {
    const list = vi.fn(async (_robotId?: number, severity?: string) =>
      severity === 'HIGH' ? HIGH : ALL,
    );
    const api = fakeApi(list);
    const { result } = renderHook(() => useIncidents(api));
    await waitFor(() => expect(result.current.incidents).toEqual(ALL));

    act(() => result.current.setSeverity('HIGH'));
    await waitFor(() => expect(result.current.incidents).toEqual(HIGH));
    expect(list).toHaveBeenLastCalledWith(undefined, 'HIGH');
    expect(result.current.activeSeverity).toBe('HIGH');

    act(() => result.current.resetSeverity());
    await waitFor(() => expect(result.current.incidents).toEqual(ALL));
    expect(list).toHaveBeenLastCalledWith();
    expect(result.current.severity).toBeNull();
    expect(result.current.activeSeverity).toBeNull();
  });

  it('CA-06.8 mantiene la lista anterior mientras carga', async () => {
    const pending = deferred<Incident[]>();
    const list = vi
      .fn<IncidentsApi['list']>()
      .mockResolvedValueOnce(ALL)
      .mockReturnValueOnce(pending.promise);
    const api = fakeApi(list);
    const { result } = renderHook(() => useIncidents(api));
    await waitFor(() => expect(result.current.incidents).toEqual(ALL));

    act(() => result.current.setSeverity('HIGH'));
    expect(result.current.status.list.loading).toBe(true);
    expect(result.current.incidents).toEqual(ALL);
    expect(result.current.activeSeverity).toBeNull();

    await act(async () => pending.resolve(HIGH));
    expect(result.current.incidents).toEqual(HIGH);
    expect(result.current.activeSeverity).toBe('HIGH');
  });

  it('CA-06.8 con dos peticiones fuera de orden gana la última emitida', async () => {
    const slow = deferred<Incident[]>();
    const fast = deferred<Incident[]>();
    const list = vi
      .fn<IncidentsApi['list']>()
      .mockResolvedValueOnce(ALL)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);
    const api = fakeApi(list);
    const { result } = renderHook(() => useIncidents(api));
    await waitFor(() => expect(result.current.incidents).toEqual(ALL));

    act(() => result.current.setSeverity('HIGH')); // emitida primero, responde última
    act(() => result.current.setSeverity('LOW')); // emitida última
    const low = [make(2, 'LOW')];
    await act(async () => fast.resolve(low));
    await act(async () => slow.resolve(HIGH));

    expect(result.current.incidents).toEqual(low);
    expect(result.current.activeSeverity).toBe('LOW');
  });

  it('CA-06.8 si la petición falla conserva la lista y la severidad activa anteriores y muestra el error', async () => {
    const list = vi
      .fn<IncidentsApi['list']>()
      .mockResolvedValueOnce(ALL)
      .mockResolvedValueOnce(HIGH)
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Fallo'));
    const api = fakeApi(list);
    const { result } = renderHook(() => useIncidents(api));
    await waitFor(() => expect(result.current.incidents).toEqual(ALL));
    act(() => result.current.setSeverity('HIGH'));
    await waitFor(() => expect(result.current.activeSeverity).toBe('HIGH'));

    act(() => result.current.setSeverity('LOW'));
    await waitFor(() => expect(result.current.status.list.error).toBe('Fallo (INTERNAL_ERROR)'));
    expect(result.current.incidents).toEqual(HIGH);
    expect(result.current.activeSeverity).toBe('HIGH');
  });

  it('CA-06.9 cada instancia del hook tiene su propio filtro', async () => {
    const list = vi.fn(async (_robotId?: number, severity?: string) =>
      severity === 'HIGH' ? HIGH : ALL,
    );
    const api = fakeApi(list);
    const a = renderHook(() => useIncidents(api));
    const b = renderHook(() => useIncidents(api));
    await waitFor(() => expect(b.result.current.incidents).toEqual(ALL));

    act(() => a.result.current.setSeverity('HIGH'));
    await waitFor(() => expect(a.result.current.incidents).toEqual(HIGH));
    expect(b.result.current.severity).toBeNull();
    expect(b.result.current.incidents).toEqual(ALL);
  });

  it('refresh vuelve a pedir con la severidad vigente', async () => {
    const list = vi.fn(async (_robotId?: number, severity?: string) =>
      severity === 'HIGH' ? HIGH : ALL,
    );
    const api = fakeApi(list);
    const { result } = renderHook(() => useIncidents(api));
    await waitFor(() => expect(result.current.incidents).toEqual(ALL));
    act(() => result.current.setSeverity('HIGH'));
    await waitFor(() => expect(result.current.activeSeverity).toBe('HIGH'));

    await act(async () => result.current.refresh());
    expect(list).toHaveBeenLastCalledWith(undefined, 'HIGH');
  });
});
