import type { LastRequest, Point, RobotId } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Acceso a la sesión vigente de cada robot (tabla `robot_sessions`, spec 003 DD-122). */
export interface SessionRepository {
  /** Sesión vigente del robot, o `null` si no ha iniciado ninguna. */
  findSessionId(robotId: RobotId): string | null;
  /** Última secuencia aceptada de la sesión vigente; 0 si no hay solicitudes (o no hay sesión). */
  findLastSequence(robotId: RobotId): number;
  /** Última solicitud aceptada; `null` si `last_sequence = 0` o no hay sesión. */
  findLastRequest(robotId: RobotId): LastRequest | null;
  /** Sustituye la sesión del robot y reinicia la última solicitud. */
  replaceSession(robotId: RobotId, sessionId: string): void;
  /** Registra la solicitud aceptada; lanza si el robot no tiene sesión. */
  recordAccepted(robotId: RobotId, sequence: number, destination: Point): void;
}

interface SessionRow {
  session_id: string;
  last_sequence: number;
  last_destination_x: number | null;
  last_destination_y: number | null;
  last_accepted_at: string | null;
}

/** Repositorio SQLite de sesiones. Todas las consultas son parametrizadas. */
export function createSessionRepository(db: Db): SessionRepository {
  const findStmt = db.prepare<[number], SessionRow>(
    `SELECT session_id, last_sequence, last_destination_x, last_destination_y, last_accepted_at
     FROM robot_sessions WHERE robot_id = ?`,
  );
  const replaceStmt = db.prepare(
    `INSERT INTO robot_sessions (robot_id, session_id)
     VALUES (@robotId, @sessionId)
     ON CONFLICT(robot_id) DO UPDATE SET
       session_id = excluded.session_id,
       last_sequence = 0,
       last_destination_x = NULL,
       last_destination_y = NULL,
       last_accepted_at = NULL,
       started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  );
  const acceptStmt = db.prepare(
    `UPDATE robot_sessions
     SET last_sequence = @sequence, last_destination_x = @x, last_destination_y = @y,
         last_accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE robot_id = @robotId`,
  );

  return {
    findSessionId(robotId) {
      return findStmt.get(robotId)?.session_id ?? null;
    },
    findLastSequence(robotId) {
      return findStmt.get(robotId)?.last_sequence ?? 0;
    },
    findLastRequest(robotId) {
      const row = findStmt.get(robotId);
      if (
        !row ||
        row.last_sequence === 0 ||
        row.last_destination_x === null ||
        row.last_destination_y === null ||
        row.last_accepted_at === null
      ) {
        return null;
      }
      return {
        sessionId: row.session_id,
        sequence: row.last_sequence,
        destination: { x: row.last_destination_x, y: row.last_destination_y },
        acceptedAt: row.last_accepted_at,
      };
    },
    replaceSession(robotId, sessionId) {
      replaceStmt.run({ robotId, sessionId });
    },
    recordAccepted(robotId, sequence, destination) {
      const result = acceptStmt.run({ robotId, sequence, x: destination.x, y: destination.y });
      if (result.changes === 0) throw new Error(`robot ${robotId} has no session`);
    },
  };
}
