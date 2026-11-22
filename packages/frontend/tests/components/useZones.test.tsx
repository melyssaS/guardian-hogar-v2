import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ZonesApi } from '../../src/api/client';
import { useZones } from '../../src/hooks/useZones';
import type { Zone } from '../../src/types';

const z1: Zone = {
  id: 1,
  name: 'A',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  active: true,
  createdAt: '',
};

function fakeApi(overrides: Partial<ZonesApi> = {}): ZonesApi {
  return {
    list: vi.fn().mockResolvedValue([z1]),
    get: vi.fn(),
    create: vi.fn().mockResolvedValue(z1),
    update: vi.fn().mockResolvedValue(z1),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('useZones', () => {
  it('carga todas las zonas al montar', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useZones(api));
    await waitFor(() => expect(result.current.status.list.loading).toBe(false));
    expect(api.list).toHaveBeenCalledWith('all');
    expect(result.current.zones).toEqual([z1]);
  });

  it('RF-01.4 refresca la lista tras cada mutación', async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useZones(api));
    await waitFor(() => expect(result.current.status.list.loading).toBe(false));
    await act(() => result.current.setActive(1, false));
    expect(api.update).toHaveBeenCalledWith(1, { active: false });
    await act(() => result.current.remove(1));
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('expone el error de la operación que falló', async () => {
    const api = fakeApi({
      create: vi.fn().mockRejectedValue(new ApiError(409, 'ZONE_NAME_DUPLICATE', 'Duplicado')),
    });
    const { result } = renderHook(() => useZones(api));
    await waitFor(() => expect(result.current.status.list.loading).toBe(false));
    let ok = true;
    await act(async () => {
      ok = await result.current.create({ ...z1 });
    });
    expect(ok).toBe(false);
    expect(result.current.status.create.error).toBe('Duplicado (ZONE_NAME_DUPLICATE)');
    expect(result.current.status.list.error).toBeNull();
  });
});
