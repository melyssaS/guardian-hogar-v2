import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, robotsApi, type RobotsApi } from '../api/client';
import type {
  MoveCommand,
  MoveResponse,
  Point,
  PositionResponse,
  RecoverResponse,
  RobotStatus,
} from '../types';

export type RobotOperation = 'robot' | 'move' | 'recover' | 'session' | 'signal';

export interface OperationState {
  loading: boolean;
  error: string | null;
}

const idle: OperationState = { loading: false, error: null };

/** Texto del error tal como lo devuelve la API: `mensaje (CÓDIGO)` o `mensaje (CÓDIGO: causa)`. */
export function messageOf(err: unknown): string {
  if (err instanceof ApiError) {
    const cause = (err.body as { cause?: unknown } | null)?.cause;
    return typeof cause === 'string'
      ? `${err.message} (${err.code}: ${cause})`
      : `${err.message} (${err.code})`;
  }
  return 'Error inesperado';
}

/** Sesión de movimiento de un robot, en memoria (spec 003 RF-08.6, DD-114). */
interface SessionState {
  sessionId: string;
  /** Última secuencia enviada; la siguiente solicitud usa `sequence + 1`. */
  sequence: number;
}

/**
 * Estado de un robot y última decisión del vigilante, tal como los devuelve la API (RF-04).
 * No evalúa reglas: solo pide, guarda y expone respuestas. Carga/error por operación (RF-04.5).
 *
 * Guarda el `sessionId` y el contador `sequence` de cada robot en memoria: la primera solicitud
 * inicia la sesión y cada movimiento incrementa la secuencia sin que el operador la escriba
 * (RF-08.6). "Nueva sesión" la sustituye y reinicia el contador. Las señales de pérdida y
 * recuperación envían la última posición que devolvió la API (la UI no la calcula, Q-B).
 */
export function useRobot(robotId: number, api: RobotsApi = robotsApi) {
  const [robot, setRobot] = useState<RobotStatus | null>(null);
  const [lastResult, setLastResult] = useState<MoveResponse | null>(null);
  // Última solicitud enviada y su respuesta, sin transformar (Telemetría, RF-08.7).
  const [lastExchange, setLastExchange] = useState<{
    request: MoveCommand;
    response: MoveResponse;
  } | null>(null);
  const [lastRecover, setLastRecover] = useState<RecoverResponse | null>(null);
  const [lastSignal, setLastSignal] = useState<PositionResponse | null>(null);
  const [status, setStatus] = useState<Record<RobotOperation, OperationState>>({
    robot: { loading: true, error: null },
    move: idle,
    recover: idle,
    session: idle,
    signal: idle,
  });
  const sessions = useRef(new Map<number, SessionState>());
  // Último estado devuelto por la API para el robot actual (posición de las señales).
  const latest = useRef<RobotStatus | null>(null);

  const setOp = (op: RobotOperation, state: OperationState) =>
    setStatus((prev) => ({ ...prev, [op]: state }));

  const refresh = useCallback(async () => {
    setOp('robot', { loading: true, error: null });
    try {
      const next = await api.getState(robotId);
      latest.current = next;
      setRobot(next);
      setOp('robot', idle);
    } catch (err) {
      setOp('robot', { loading: false, error: messageOf(err) });
    }
  }, [api, robotId]);

  useEffect(() => {
    // Al cambiar de robot se olvida lo mostrado del anterior; sus sesiones se conservan.
    latest.current = null;
    setRobot(null);
    setLastResult(null);
    setLastExchange(null);
    setLastRecover(null);
    setLastSignal(null);
    void refresh();
  }, [refresh]);

  /** "Nueva sesión": invalida la anterior del robot y reinicia el contador. */
  const startSession = useCallback(async (): Promise<string | null> => {
    setOp('session', { loading: true, error: null });
    try {
      const { sessionId } = await api.startSession(robotId);
      sessions.current.set(robotId, { sessionId, sequence: 0 });
      setOp('session', idle);
      return sessionId;
    } catch (err) {
      setOp('session', { loading: false, error: messageOf(err) });
      return null;
    }
  }, [api, robotId]);

  /** Envía el destino con sesión y secuencia automáticas; devuelve la decisión o `null`. */
  const move = useCallback(
    async (destination: Point): Promise<MoveResponse | null> => {
      setOp('move', { loading: true, error: null });
      try {
        let session = sessions.current.get(robotId);
        if (!session) {
          const { sessionId } = await api.startSession(robotId);
          session = { sessionId, sequence: 0 };
          sessions.current.set(robotId, session);
        }
        session.sequence += 1;
        const command: MoveCommand = {
          destination,
          sessionId: session.sessionId,
          sequence: session.sequence,
        };
        const result = await api.move(robotId, command);
        setLastResult(result);
        setLastExchange({ request: command, response: result });
        setOp('move', idle);
        await refresh();
        return result;
      } catch (err) {
        setOp('move', { loading: false, error: messageOf(err) });
        return null;
      }
    },
    [api, robotId, refresh],
  );

  /** "Liberar parada": `transitioned` distingue "Parada liberada" de "ya estaba en IDLE". */
  const recover = useCallback(async (): Promise<RecoverResponse | null> => {
    setOp('recover', { loading: true, error: null });
    try {
      const result = await api.recover(robotId);
      setLastRecover(result);
      setOp('recover', idle);
      await refresh();
      return result;
    } catch (err) {
      setLastRecover(null);
      setOp('recover', { loading: false, error: messageOf(err) });
      await refresh();
      return null;
    }
  }, [api, robotId, refresh]);

  const sendSignal = useCallback(
    async (quality: 'MISSING' | 'RELIABLE'): Promise<PositionResponse | null> => {
      const current = latest.current;
      if (!current) return null; // la posición la da la API: sin estado no hay nada que enviar
      setOp('signal', { loading: true, error: null });
      try {
        const result = await api.sendPosition(robotId, { position: current.position, quality });
        setLastSignal(result);
        setOp('signal', idle);
        await refresh();
        return result;
      } catch (err) {
        setOp('signal', { loading: false, error: messageOf(err) });
        return null;
      }
    },
    [api, robotId, refresh],
  );

  /** "⌁ Perder conexión": envía `MISSING` con la última posición devuelta por la API. */
  const loseSignal = useCallback(() => sendSignal('MISSING'), [sendSignal]);
  /** "↻ Recuperar señal": envía `RELIABLE` con la última posición devuelta por la API. */
  const restoreSignal = useCallback(() => sendSignal('RELIABLE'), [sendSignal]);

  return {
    robot,
    lastResult,
    lastExchange,
    lastRecover,
    lastSignal,
    status,
    refresh,
    startSession,
    move,
    recover,
    loseSignal,
    restoreSignal,
  };
}
