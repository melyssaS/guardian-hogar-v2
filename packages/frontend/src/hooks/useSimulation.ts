import { useCallback, useEffect, useState } from 'react';
import { ApiError, simulationApi, type SimulationApi } from '../api/client';
import type { MoveResult, Point, RobotSnapshot } from '../types';

export type SimulationOperation = 'robot' | 'move' | 'reset';

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
 * Estado del robot y última decisión del vigilante, tal como los devuelve la API (RF-04).
 * No evalúa reglas: solo pide, guarda y expone respuestas. Carga/error por operación (RF-04.5).
 */
export function useSimulation(api: SimulationApi = simulationApi) {
  const [robot, setRobot] = useState<RobotSnapshot | null>(null);
  const [lastResult, setLastResult] = useState<MoveResult | null>(null);
  const [status, setStatus] = useState<Record<SimulationOperation, OperationState>>({
    robot: { loading: true, error: null },
    move: idle,
    reset: idle,
  });

  const setOp = (op: SimulationOperation, state: OperationState) =>
    setStatus((prev) => ({ ...prev, [op]: state }));

  const refresh = useCallback(async () => {
    setOp('robot', { loading: true, error: null });
    try {
      setRobot(await api.getRobot());
      setOp('robot', idle);
    } catch (err) {
      setOp('robot', { loading: false, error: messageOf(err) });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Envía el destino; devuelve la decisión o `null` si la solicitud falló. */
  const move = useCallback(
    async (destination: Point): Promise<MoveResult | null> => {
      setOp('move', { loading: true, error: null });
      try {
        const result = await api.move(destination);
        setLastResult(result);
        // Primero el estado de la respuesta (p. ej. MOVING); luego el actual del servidor (IDLE).
        setRobot({ state: result.state, position: result.position });
        setOp('move', idle);
        await refresh();
        return result;
      } catch (err) {
        setOp('move', { loading: false, error: messageOf(err) });
        return null;
      }
    },
    [api, refresh],
  );

  const reset = useCallback(async (): Promise<boolean> => {
    setOp('reset', { loading: true, error: null });
    try {
      setRobot(await api.reset());
      setLastResult(null);
      setOp('reset', idle);
      return true;
    } catch (err) {
      setOp('reset', { loading: false, error: messageOf(err) });
      return false;
    }
  }, [api]);

  return { robot, lastResult, status, refresh, move, reset };
}
