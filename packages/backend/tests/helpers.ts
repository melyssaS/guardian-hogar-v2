import type { Point, RobotId } from '@home-guardian/domain';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type Db } from '../src/db/connection.js';
import { MIGRATIONS_DIR, migrate } from '../src/db/migrate.js';
import { createAuditLogRepository } from '../src/repositories/auditLogRepository.js';
import { createRobotRepository } from '../src/repositories/robotRepository.js';
import { createSessionRepository } from '../src/repositories/sessionRepository.js';
import {
  createGuardianService,
  type GuardianService,
  type GuardianServiceDeps,
  type PerRobotMoveOutcome,
} from '../src/services/guardianService.js';
import { createSessionService, type SessionService } from '../src/services/sessionService.js';

/**
 * Base con solo las migraciones anteriores a `version` (p. ej. `'009'`), para probar que una
 * migración conserva las filas ya existentes. El resto se aplica después con `migrate(db)`.
 */
export function createDbBefore(version: string): Db {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f < version)) {
    copyFileSync(join(MIGRATIONS_DIR, file), join(dir, file));
  }
  const db = createDatabase(':memory:');
  migrate(db, dir);
  return db;
}

export function createTestDb(): Db {
  const db = createDatabase(':memory:');
  migrate(db);
  return db;
}

/** Filas de `movement_log` sin id ni fecha, en orden de inserción. */
export function readMovementLog(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare(
      `SELECT decision, state_after, origin_x, origin_y, dest_x, dest_y, collision_type,
              zone_name, reason
       FROM movement_log ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;
}

export const stairs = { name: 'Escaleras', x: 100, y: 100, width: 200, height: 150, active: true };

/** `sessionService` real sobre la misma base en memoria. */
export function createTestSessions(db: Db): SessionService {
  return createSessionService({
    sessions: createSessionRepository(db),
    audit: createAuditLogRepository(db),
    robots: createRobotRepository(db),
    runInTransaction: (fn) => db.transaction(fn)(),
  });
}

/**
 * Vigilante de prueba: el `move` por robot exige sesión y secuencia (spec 003 R8, spec 002 R11),
 * así que las pruebas del servicio lo llaman a través de este envoltorio, que arma el
 * `MoveCommand` (`destination` + sesión vigente + secuencia creciente) de cada robot. La sesión
 * se crea directo en el repositorio (sin auditar `SESSION_STARTED`) para no ensuciar `audit_log`.
 * Usa siempre el `move` por robot: RC-20 no retira estas pruebas.
 */
export type TestGuardian = Omit<GuardianService, 'move'> & {
  move(robotId: RobotId, destination: Point): PerRobotMoveOutcome;
};

export function createTestGuardian(
  db: Db,
  deps: Omit<GuardianServiceDeps, 'sessions'>,
): TestGuardian {
  const sessions = createSessionRepository(db);
  const service = createGuardianService({ ...deps, sessions: createTestSessions(db) });
  const sequences = new Map<RobotId, number>();
  return {
    ...service,
    move(robotId, destination) {
      // Un robot inexistente no admite sesión (FK): se deja pasar para probar el 404 del servicio.
      let sessionId = sessions.findSessionId(robotId);
      if (sessionId === null && db.prepare('SELECT 1 FROM robots WHERE id = ?').get(robotId)) {
        sessionId = randomUUID();
        sessions.replaceSession(robotId, sessionId);
      }
      const sequence = (sequences.get(robotId) ?? 0) + 1;
      sequences.set(robotId, sequence);
      const result = service.move(robotId, {
        destination,
        sessionId: sessionId ?? randomUUID(),
        sequence,
      });
      if ('kind' in result) {
        throw new Error(`unexpected session rejection ${result.code}: ${result.message}`);
      }
      return result;
    },
  };
}
