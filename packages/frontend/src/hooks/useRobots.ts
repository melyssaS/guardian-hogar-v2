import { useCallback, useEffect, useState } from 'react';
import { robotsApi, type RobotsApi } from '../api/client';
import type { Robot, RobotInput } from '../types';
import { messageOf, type OperationState } from './useRobot';

export type RobotsOperation = 'list' | 'register';

const idle: OperationState = { loading: false, error: null };

/**
 * Lista de robots del catálogo y alta (spec 003 RF-07). Muestra tal cual los errores de la API
 * (`INVALID_ROBOT`, `ROBOT_NAME_DUPLICATE`, `ROBOT_START_IN_RESTRICTED_ZONE`,
 * `ROBOT_START_NOT_VERIFIABLE`); no decide nada. Carga/error por operación.
 */
export function useRobots(api: RobotsApi = robotsApi) {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [status, setStatus] = useState<Record<RobotsOperation, OperationState>>({
    list: { loading: true, error: null },
    register: idle,
  });

  const setOp = (op: RobotsOperation, state: OperationState) =>
    setStatus((prev) => ({ ...prev, [op]: state }));

  const refresh = useCallback(async () => {
    setOp('list', { loading: true, error: null });
    try {
      setRobots(await api.list());
      setOp('list', idle);
    } catch (err) {
      setOp('list', { loading: false, error: messageOf(err) });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Registra un robot; devuelve el robot creado o `null` si la API lo rechazó. */
  const register = useCallback(
    async (input: RobotInput): Promise<Robot | null> => {
      setOp('register', { loading: true, error: null });
      try {
        const created = await api.register(input);
        setOp('register', idle);
        await refresh();
        return created;
      } catch (err) {
        setOp('register', { loading: false, error: messageOf(err) });
        return null;
      }
    },
    [api, refresh],
  );

  return { robots, status, refresh, register };
}
