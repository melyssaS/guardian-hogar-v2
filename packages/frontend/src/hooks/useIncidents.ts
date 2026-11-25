import { useCallback, useEffect, useRef, useState } from 'react';
import { incidentsApi, type IncidentsApi } from '../api/client';
import type { Incident, IncidentDetail, Severity } from '../types';
import { messageOf, type OperationState } from './useRobot';

export type IncidentsOperation = 'list' | 'detail';

const idle: OperationState = { loading: false, error: null };

/**
 * Lista y detalle de incidentes (spec 003 RF-09) con filtro opcional por severidad (spec 006,
 * HU-06). Solo lectura: pide y expone lo que devuelve la API, en el orden recibido (más reciente
 * primero); no filtra, no ordena ni recalcula nada en el cliente.
 *
 * - `severity`: la elegida en el control (`null` = todas).
 * - `activeSeverity`: la de la última petición completada con éxito (DD-609); decide el mensaje vacío.
 * - Cada instancia del hook tiene su propio filtro: `SimulationPage` sigue recibiendo la lista completa.
 * - Con varias peticiones en vuelo gana la última emitida; si una falla se conservan la lista y la
 *   severidad activa anteriores.
 */
export function useIncidents(api: IncidentsApi = incidentsApi) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [severity, setSeverityState] = useState<Severity | null>(null);
  const [activeSeverity, setActiveSeverity] = useState<Severity | null>(null);
  const [status, setStatus] = useState<Record<IncidentsOperation, OperationState>>({
    list: { loading: true, error: null },
    detail: idle,
  });
  const latestRequest = useRef(0);
  const currentSeverity = useRef<Severity | null>(null);

  const setOp = (op: IncidentsOperation, state: OperationState) =>
    setStatus((prev) => ({ ...prev, [op]: state }));

  const load = useCallback(
    async (wanted: Severity | null) => {
      const requestId = ++latestRequest.current;
      setOp('list', { loading: true, error: null });
      try {
        const list = wanted === null ? await api.list() : await api.list(undefined, wanted);
        if (requestId !== latestRequest.current) return;
        setIncidents(list);
        setActiveSeverity(wanted);
        setOp('list', idle);
      } catch (err) {
        if (requestId !== latestRequest.current) return;
        setOp('list', { loading: false, error: messageOf(err) });
      }
    },
    [api],
  );

  const refresh = useCallback(() => load(currentSeverity.current), [load]);

  useEffect(() => {
    void load(null);
  }, [load]);

  const setSeverity = useCallback(
    (next: Severity | null) => {
      currentSeverity.current = next;
      setSeverityState(next);
      void load(next);
    },
    [load],
  );

  const resetSeverity = useCallback(() => setSeverity(null), [setSeverity]);

  /** Carga el detalle (con el snapshot de zonas) del incidente elegido; no depende del filtro. */
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

  return {
    incidents,
    detail,
    status,
    severity,
    activeSeverity,
    setSeverity,
    resetSeverity,
    refresh,
    select,
  };
}
