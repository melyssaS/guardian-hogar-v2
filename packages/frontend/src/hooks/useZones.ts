import { useCallback, useEffect, useState } from 'react';
import { ApiError, zonesApi, type ZonesApi } from '../api/client';
import type { UpdateZoneBody, Zone, ZoneInput } from '../types';

export type ZoneOperation = 'list' | 'create' | 'update' | 'remove';

export interface OperationState {
  loading: boolean;
  error: string | null;
}

const idle: OperationState = { loading: false, error: null };

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return `${err.message} (${err.code})`;
  return 'Error inesperado';
}

/**
 * Carga todas las zonas (activas e inactivas, para poder reactivarlas) y expone mutaciones
 * que refrescan la lista al terminar (RF-01.4). Estado de carga/error por operación.
 */
export function useZones(api: ZonesApi = zonesApi) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [status, setStatus] = useState<Record<ZoneOperation, OperationState>>({
    list: { loading: true, error: null },
    create: idle,
    update: idle,
    remove: idle,
  });

  const setOp = (op: ZoneOperation, state: OperationState) =>
    setStatus((prev) => ({ ...prev, [op]: state }));

  const refresh = useCallback(async () => {
    setOp('list', { loading: true, error: null });
    try {
      setZones(await api.list('all'));
      setOp('list', idle);
    } catch (err) {
      setOp('list', { loading: false, error: messageOf(err) });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (op: Exclude<ZoneOperation, 'list'>, action: () => Promise<unknown>) => {
      setOp(op, { loading: true, error: null });
      try {
        await action();
        setOp(op, idle);
        await refresh();
        return true;
      } catch (err) {
        setOp(op, { loading: false, error: messageOf(err) });
        return false;
      }
    },
    [refresh],
  );

  return {
    zones,
    status,
    refresh,
    create: (input: ZoneInput) => run('create', () => api.create(input)),
    update: (id: number, input: UpdateZoneBody) => run('update', () => api.update(id, input)),
    setActive: (id: number, active: boolean) => run('update', () => api.update(id, { active })),
    remove: (id: number) => run('remove', () => api.remove(id)),
  };
}
