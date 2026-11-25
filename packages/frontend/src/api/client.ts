import type {
  Incident,
  IncidentCounts,
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
  Severity,
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

/** `fetch` al backend; un fallo de red se convierte en `NETWORK_ERROR`. */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
  }
}

/** Traduce una respuesta no-OK al `ApiError` con el `{ code, message }` del backend. */
function toApiError(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) return new ApiError(status, body.code, body.message, body);
  return new ApiError(status, 'HTTP_ERROR', `Error HTTP ${status}`, body);
}

/** Única puerta de salida HTTP del frontend. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, body);
  return body as T;
}

/** Archivo descargado del backend tal cual llega, con su nombre (spec 007). */
export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** `filename="…"` de `Content-Disposition`, o `fallback` si no se puede leer (CA-07.10). */
function filenameOf(res: Response, fallback: string): string {
  const header = res.headers.get('Content-Disposition') ?? '';
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback;
}

/**
 * Pide un archivo con el mismo manejo de errores que `request` (spec 007, I-4). El `Blob` es el
 * cuerpo recibido, sin transformar (CA-07.11).
 */
export async function requestBlob(path: string, fallbackName: string): Promise<DownloadedFile> {
  const res = await send(path, {});
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
  return { blob: await res.blob(), filename: filenameOf(res, fallbackName) };
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
  /** `robotId` y `severity` son opcionales; sin ninguno pide exactamente `/api/incidents` (spec 006). */
  list: (robotId?: number, severity?: Severity) => {
    const params: string[] = [];
    if (robotId !== undefined) params.push(`robotId=${robotId}`);
    if (severity !== undefined) params.push(`severity=${severity}`);
    return request<Incident[]>(
      `/api/incidents${params.length === 0 ? '' : `?${params.join('&')}`}`,
    );
  },
  get: (id: number) => request<IncidentDetail>(`/api/incidents/${id}`),
  /** HU-07 (spec 007): CSV generado por el backend; la vista no filtra por robot (CA-07.10). */
  exportCsv: () => requestBlob('/api/incidents/export', 'incidentes.csv'),
  // HU-08: conteo global por tipo; sin parámetros (DD-08.6/DD-08.9, H-7).
  counts: () => request<IncidentCounts>('/api/incidents/counts'),
};

export type IncidentsApi = typeof incidentsApi;
