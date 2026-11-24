import { useCallback, useEffect, useState } from 'react';
import { incidentsApi, type IncidentsApi } from '../api/client';
import type { Incident, IncidentDetail } from '../types';
import { messageOf, type OperationState } from './useRobot';

export type IncidentsOperation = 'list' | 'detail';

const idle: OperationState = { loading: false, error: null };

/**
 * Lista y detalle de incidentes (spec 003 RF-09). Solo lectura: pide y expone lo que devuelve la
 * API, en el orden recibido (más reciente primero); no modifica ni recalcula nada (RF-09.5).
 */
export function useIncidents(api: IncidentsApi = incidentsApi) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [status, setStatus] = useState<Record<IncidentsOperation, OperationState>>({
    list: { loading: true, error: null },
    detail: idle,
  });

  const setOp = (op: IncidentsOperation, state: OperationState) =>
    setStatus((prev) => ({ ...prev, [op]: state }));

  const refresh = useCallback(async () => {
    setOp('list', { loading: true, error: null });
    try {
      setIncidents(await api.list());
      setOp('list', idle);
    } catch (err) {
      setOp('list', { loading: false, error: messageOf(err) });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Carga el detalle (con el snapshot de zonas) del incidente elegido. */
  const select = useCallback(
    async (id: number) => {
      setOp('detail', { loading: true, error: null });
      try {
        setDetail(await api.get(id));
        setOp('detail', idle);
      } catch (err) {
        setOp('detail', { loading: false, error: messageOf(err) });
      }
    },
    [api],
  );

  return { incidents, detail, status, refresh, select };
}
