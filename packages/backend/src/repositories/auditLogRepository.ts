import type { Point, RobotId, RobotStateName } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Códigos de evento admitidos por el CHECK de `audit_log` (migración 011). */
export type AuditEventCode =
  | 'SAFE_STOP_ACTIVE'
  | 'BUSY'
  | 'INVALID_SESSION'
  | 'DUPLICATE_EVENT'
  | 'SESSION_STARTED'
  | 'RECOVER_NOOP'
  | 'RECOVERY_NOT_ALLOWED'
  | 'POSITION_READING'
  | 'POSITION_CONFLICT'
  | 'ROBOT_START_IN_RESTRICTED_ZONE'
  | 'ROBOT_START_NOT_VERIFIABLE';

/**
 * Evento de auditoría por robot (spec 002 R5.8-R5.10, spec 003 CA-03.34). `robotId` y `state`
 * solo pueden ser `null` en los dos rechazos del alta, que ocurren antes de que el robot
 * exista (lo impone el trigger de la 011).
 */
export interface AuditEventInput {
  robotId: RobotId | null;
  eventCode: AuditEventCode;
  state: RobotStateName | null;
  /** Punto asociado (destino rechazado, posición recibida o de alta); `x`/`y` nulos si no aplica. */
  position?: Point | null;
  /** Datos opcionales del evento; se guardan como JSON. */
  detail?: Record<string, unknown>;
}

/** Fila del log de auditoría ya leída (filas antiguas: `robotId` nulo). */
export interface AuditLogRecord {
  id: number;
  robotId: RobotId | null;
  eventCode: string;
  state: RobotStateName | null;
  x: number | null;
  y: number | null;
  detail: Record<string, unknown> | null;
  /** Marca de tiempo ISO-8601 UTC (las filas anteriores a la 011 se normalizan al leer). */
  createdAt: string;
}

/**
 * Registro append-only de la auditoría (tabla `audit_log`, migraciones 006 y 011).
 * La tabla es inmutable por triggers (R5.3, R5.4; steering seguridad).
 */
export interface AuditLogRepository {
  /** Vía por robot: registra cualquier evento auditable de la 011 (inmutable). */
  record(event: AuditEventInput): void;
  /** Todas las filas en orden de inserción, con fechas ISO. */
  findAll(): AuditLogRecord[];
}

interface AuditLogRow {
  id: number;
  robot_id: number | null;
  event_code: string;
  state: RobotStateName | null;
  x: number | null;
  y: number | null;
  detail: string | null;
  created_at: string;
}

/** Las filas anteriores a la 011 usan `datetime('now')` (UTC sin zona): se normalizan a ISO. */
function toIso(value: string): string {
  const legacy = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  return new Date(legacy ? `${value.replace(' ', 'T')}Z` : value).toISOString();
}

function toRecord(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    robotId: row.robot_id,
    eventCode: row.event_code,
    state: row.state,
    x: row.x,
    y: row.y,
    detail: row.detail === null ? null : (JSON.parse(row.detail) as Record<string, unknown>),
    createdAt: toIso(row.created_at),
  };
}

/** Repositorio SQLite del log de auditoría. Consultas parametrizadas (RF-04.1). */
export function createAuditLogRepository(db: Db): AuditLogRepository {
  const recordStmt = db.prepare(
    `INSERT INTO audit_log (robot_id, event_code, state, x, y, detail)
     VALUES (@robotId, @eventCode, @state, @x, @y, @detail)`,
  );
  const findAllStmt = db.prepare<[], AuditLogRow>(
    'SELECT id, robot_id, event_code, state, x, y, detail, created_at FROM audit_log ORDER BY id',
  );

  return {
    record({ robotId, eventCode, state, position, detail }) {
      recordStmt.run({
        robotId,
        eventCode,
        state,
        x: position?.x ?? null,
        y: position?.y ?? null,
        detail: detail === undefined ? null : JSON.stringify(detail),
      });
    },
    findAll() {
      return findAllStmt.all().map(toRecord);
    },
  };
}
