import type {
  MoveResult,
  Point,
  RobotSnapshot,
  UpdateZoneBody,
  Zone,
  ZoneActiveFilter,
  ZoneInput,
} from '../types';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

/** Error de la API con el `code` estable del backend. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Cuerpo JSON de la respuesta, si lo hubo (p. ej. el MoveResult de un 409). */
    public readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isErrorBody(value: unknown): value is { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/** Única puerta de salida HTTP del frontend. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorBody(body)) throw new ApiError(res.status, body.code, body.message, body);
    throw new ApiError(res.status, 'HTTP_ERROR', `Error HTTP ${res.status}`, body);
  }
  return body as T;
}

export const zonesApi = {
  list: (filter?: ZoneActiveFilter) =>
    request<Zone[]>(`/api/zones${filter ? `?active=${filter}` : ''}`),
  get: (id: number) => request<Zone>(`/api/zones/${id}`),
  create: (input: ZoneInput) =>
    request<Zone>('/api/zones', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: UpdateZoneBody) =>
    request<Zone>(`/api/zones/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: number) => request<void>(`/api/zones/${id}`, { method: 'DELETE' }),
};

export type ZonesApi = typeof zonesApi;

function isMoveResult(value: unknown): value is MoveResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { decision?: unknown }).decision === 'string'
  );
}

/** /api/simulation — spec 003 §5. */
export const simulationApi = {
  getRobot: () => request<RobotSnapshot>('/api/simulation/robot'),
  /**
   * Un 409 (DENIED_SAFE_STOP) es una decisión del vigilante con su MoveResult: se devuelve
   * para mostrarla (DD-102). El resto de errores (422, red…) se propagan como ApiError.
   */
  move: async (destination: Point): Promise<MoveResult> => {
    try {
      return await request<MoveResult>('/api/simulation/move', {
        method: 'POST',
        body: JSON.stringify({ destination }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isMoveResult(err.body)) return err.body;
      throw err;
    }
  },
  reset: () => request<RobotSnapshot>('/api/simulation/reset', { method: 'POST' }),
};

export type SimulationApi = typeof simulationApi;
