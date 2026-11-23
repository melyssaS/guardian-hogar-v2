/** Resultado de `checkSequence`: válida, o rechazada con el código del 409 correspondiente. */
export type SequenceCheck =
  { ok: true } | { ok: false; code: 'INVALID_SESSION' | 'DUPLICATE_EVENT' };

/**
 * Regla pura de sesión y secuencia (spec 003 R8, RF-08.3, RF-08.4, DD-112). La invoca
 * `sessionService.acceptRequest` antes del vigilante. Orden: la sesión se comprueba primero.
 *
 * - `sessionId` distinto de la sesión vigente (o robot sin sesión) → `INVALID_SESSION`.
 * - `sequence <= lastSequence` (0 = sin solicitudes aceptadas) → `DUPLICATE_EVENT`.
 * - En otro caso → `ok` (la secuencia solo debe crecer; no exige que sea consecutiva).
 */
export function checkSequence(input: {
  /** Sesión vigente del robot; `null` si no ha iniciado ninguna. */
  currentSessionId: string | null;
  /** Última secuencia aceptada en esa sesión; 0 si no hay solicitudes. */
  lastSequence: number;
  sessionId: string;
  sequence: number;
}): SequenceCheck {
  const { currentSessionId, lastSequence, sessionId, sequence } = input;
  if (currentSessionId === null || sessionId !== currentSessionId) {
    return { ok: false, code: 'INVALID_SESSION' };
  }
  if (sequence <= lastSequence) return { ok: false, code: 'DUPLICATE_EVENT' };
  return { ok: true };
}
