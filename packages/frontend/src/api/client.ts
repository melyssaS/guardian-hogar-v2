import type {
  Incident,
  IncidentDetail,
  MoveCommand,
  MoveResponse,
  PositionReading,
  PositionResponse,
  RecoverResponse,
  Robot,
  RobotInput,
  RobotStatus,
  SessionInfo,
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
    /** Cuerpo JSON de la respuesta, si lo hubo (p. ej. la decisión REJECTED de un 409). */
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

function isMoveResponse(value: unknown): value is MoveResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { decision?: unknown }).decision === 'string'
  );
}

/**
 * /api/robots — catálogo, sesiones y rutas por robot (spec 003 §5, spec 002 §6). La UI solo
 * transporta: no decide ni calcula nada (art. III).
 */
export const robotsApi = {
  list: () => request<Robot[]>('/api/robots'),
  get: (robotId: number) => request<Robot>(`/api/robots/${robotId}`),
  register: (input: RobotInput) =>
    request<Robot>('/api/robots', { method: 'POST', body: JSON.stringify(input) }),
  getState: (robotId: number) => request<RobotStatus>(`/api/robots/${robotId}/state`),
  startSession: (robotId: number) =>
    request<SessionInfo>(`/api/robots/${robotId}/sessions`, { method: 'POST' }),
  /**
   * Un 409 con cuerpo de decisión (`REJECTED`) es una decisión del vigilante y se devuelve para
   * mostrarla (DD-102). Un 409 `{ code, message }` (`INVALID_SESSION`, `DUPLICATE_EVENT`) y el
   * resto de errores se propagan como `ApiError`.
   */
  move: async (robotId: number, command: MoveCommand): Promise<MoveResponse> => {
    try {
      return await request<MoveResponse>(`/api/robots/${robotId}/move`, {
        method: 'POST',
        body: JSON.stringify(command),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isMoveResponse(err.body)) {
        return err.body;
      }
      throw err;
    }
  },
  recover: (robotId: number) =>
    request<RecoverResponse>(`/api/robots/${robotId}/recover`, { method: 'POST' }),
  sendPosition: (robotId: number, reading: PositionReading) =>
    request<PositionResponse>(`/api/robots/${robotId}/position`, {
      method: 'POST',
      body: JSON.stringify(reading),
    }),
};

export type RobotsApi = typeof robotsApi;

/** /api/incidents — solo lectura (spec 002 §6, spec 003 RF-09). */
export const incidentsApi = {
  list: (robotId?: number) =>
    request<Incident[]>(`/api/incidents${robotId === undefined ? '' : `?robotId=${robotId}`}`),
  get: (id: number) => request<IncidentDetail>(`/api/incidents/${id}`),
};

export type IncidentsApi = typeof incidentsApi;
