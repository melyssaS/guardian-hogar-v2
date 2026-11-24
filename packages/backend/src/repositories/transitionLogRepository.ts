import type { RobotId, RobotStateName, TransitionCause } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Transición a registrar (spec 002 R9). `fromState` es `null` solo en alta o fila base. */
export interface TransitionLogInput {
  robotId: RobotId;
  fromState: RobotStateName | null;
  toState: RobotStateName;
  cause: TransitionCause;
  /** Datos opcionales (destino, sesión, incidente, snapshot de zonas); se guardan como JSON. */
  detail?: Record<string, unknown>;
}

/** Transición persistida e inmutable. */
export interface TransitionLogEntry {
  id: number;
  robotId: RobotId;
  fromState: RobotStateName | null;
  toState: RobotStateName;
  cause: TransitionCause;
  detail: Record<string, unknown> | null;
  /** Marca de tiempo ISO-8601. */
  createdAt: string;
}

/** Registro append-only: solo inserción y lectura por robot (R9, R5.9). */
export interface TransitionLogRepository {
  append(entry: TransitionLogInput): void;
  /** Transiciones de un robot, de la más antigua a la más reciente. */
  findByRobot(robotId: RobotId): TransitionLogEntry[];
}

interface TransitionLogRow {
  id: number;
  robot_id: number;
  from_state: RobotStateName | null;
  to_state: RobotStateName;
  cause: TransitionCause;
  detail: string | null;
  created_at: string;
}

function toEntry(row: TransitionLogRow): TransitionLogEntry {
  return {
    id: row.id,
    robotId: row.robot_id,
    fromState: row.from_state,
    toState: row.to_state,
    cause: row.cause,
    detail: row.detail === null ? null : (JSON.parse(row.detail) as Record<string, unknown>),
    createdAt: row.created_at,
  };
}

/** Repositorio SQLite del registro de transiciones. Consultas parametrizadas. */
export function createTransitionLogRepository(db: Db): TransitionLogRepository {
  const insertStmt = db.prepare(
    `INSERT INTO state_transition_log (robot_id, from_state, to_state, cause, detail)
     VALUES (@robotId, @fromState, @toState, @cause, @detail)`,
  );
  const findByRobotStmt = db.prepare<[number], TransitionLogRow>(
    `SELECT id, robot_id, from_state, to_state, cause, detail, created_at
     FROM state_transition_log WHERE robot_id = ? ORDER BY id`,
  );

  return {
    append({ robotId, fromState, toState, cause, detail }) {
      insertStmt.run({
        robotId,
        fromState,
        toState,
        cause,
        detail: detail === undefined ? null : JSON.stringify(detail),
      });
    },
    findByRobot(robotId) {
      return findByRobotStmt.all(robotId).map(toEntry);
    },
  };
}
