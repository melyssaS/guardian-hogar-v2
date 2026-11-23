import type { DecisionCode, Point, RobotStateName } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/**
 * Entrada del log de auditoría: un rechazo por estado (spec 002 §4 paso 7, R5.3).
 * Se registran únicamente los rechazos `SAFE_STOP_ACTIVE` y `BUSY`, que NO generan incidente.
 */
export interface AuditLogEntry {
  /** Código del rechazo por estado: `SAFE_STOP_ACTIVE` o `BUSY`. */
  eventCode: Extract<DecisionCode, 'SAFE_STOP_ACTIVE' | 'BUSY'>;
  /** Estado del robot en el momento del rechazo. */
  state: RobotStateName;
  /** Destino solicitado que fue rechazado por estado. */
  destination: Point;
}

/**
 * Registro append-only de rechazos por estado (tabla `audit_log`, migración 006).
 * Solo expone inserción: la tabla es inmutable por triggers (R5.3, R5.4; steering seguridad).
 */
export interface AuditLogRepository {
  append(entry: AuditLogEntry): void;
}

/** Repositorio SQLite del log de auditoría. Consultas parametrizadas (RF-04.1). */
export function createAuditLogRepository(db: Db): AuditLogRepository {
  const insertStmt = db.prepare(
    `INSERT INTO audit_log (event_code, state, dest_x, dest_y)
     VALUES (@eventCode, @state, @destX, @destY)`,
  );

  return {
    append({ eventCode, state, destination }) {
      insertStmt.run({
        eventCode,
        state,
        destX: destination.x,
        destY: destination.y,
      });
    },
  };
}
