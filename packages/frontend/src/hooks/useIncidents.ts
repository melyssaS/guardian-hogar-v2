import { useCallback, useEffect, useRef, useState } from 'react';
import { incidentsApi, type IncidentsApi } from '../api/client';
import type { Incident, IncidentCounts, IncidentDetail, Severity } from '../types';
import { messageOf, type OperationState } from './useRobot';

export type IncidentsOperation = 'list' | 'detail' | 'export' | 'counts';

const idle: OperationState = { loading: false, error: null };

/** Conteos vacíos iniciales: las 3 categorías en 0 llegan de la API; aquí solo evitamos `null`. */
const emptyCounts: IncidentCounts = { total: 0, byType: [] };

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
  const [counts, setCounts] = useState<IncidentCounts>(emptyCounts);
  const [status, setStatus] = useState<Record<IncidentsOperation, OperationState>>({
    list: { loading: true, error: null },
    detail: idle,
    export: idle,
    counts: { loading: true, error: null },
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
      // HU-08: los conteos se recargan junto con la lista (al montar/remontar, CA-08.7). Son
      // globales (no dependen del filtro de severidad) y su carga/error quedan AISLADOS en
      // status.counts; no se mezclan con list/detail ni con el callout global (H-5, CA-08.9).
      setOp('counts', { loading: true, error: null });
      try {
        setCounts(await api.counts());
        setOp('counts', idle);
      } catch (err) {
        setOp('counts', { loading: false, error: messageOf(err) });
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

  /**
   * HU-07 (spec 007): descarga el CSV que genera el backend, sin tocarlo (CA-07.11). Solo crea la
   * URL del blob si la respuesta fue correcta (CA-07.13).
   */
  const exportCsv = useCallback(async () => {
    setOp('export', { loading: true, error: null });
    try {
      const { blob, filename } = await api.exportCsv();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setOp('export', idle);
    } catch (err) {
      setOp('export', { loading: false, error: messageOf(err) });
    }
  }, [api]);

  return {
    incidents,
    detail,
    counts,
    status,
    severity,
    activeSeverity,
    setSeverity,
    resetSeverity,
    refresh,
    select,
    exportCsv,
  };
}
