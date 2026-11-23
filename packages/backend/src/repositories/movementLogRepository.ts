import type { MoveResult, Point } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Entrada del registro: la decisión con su origen y destino (RF-05.1). */
export interface MovementLogEntry {
  origin: Point;
  destination: Point;
  result: MoveResult;
}

/** Registro append-only: solo expone inserción (RF-05.2, DD-105). */
export interface MovementLogRepository {
  append(entry: MovementLogEntry): void;
}

export function createMovementLogRepository(db: Db): MovementLogRepository {
  const insertStmt = db.prepare(
    `INSERT INTO movement_log
       (decision, state_after, origin_x, origin_y, dest_x, dest_y, collision_type, zone_name, reason)
     VALUES
       (@decision, @stateAfter, @originX, @originY, @destX, @destY, @collisionType, @zoneName, @reason)`,
  );

  return {
    append({ origin, destination, result }) {
      insertStmt.run({
        decision: result.decision,
        stateAfter: result.state,
        originX: origin.x,
        originY: origin.y,
        destX: destination.x,
        destY: destination.y,
        collisionType: result.collisionType ?? null,
        zoneName: result.zoneName ?? null,
        reason: result.reason,
      });
    },
  };
}
