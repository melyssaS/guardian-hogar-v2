import type { Zone, ZoneChange, ZoneChangeAction } from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/** Cambio a registrar (RF-05.1). `before` es null en CREATE; `after` es null en DELETE. */
export interface ZoneChangeInput {
  zoneId: number;
  action: ZoneChangeAction;
  before: Zone | null;
  after: Zone | null;
}

/** Registro append-only de cambios de zona: solo inserción y lectura (RF-05.5, RF-05.6). */
export interface ZoneChangeLogRepository {
  append(entry: ZoneChangeInput): void;
  /** Historial completo, del más reciente al más antiguo (id DESC). */
  listAll(): ZoneChange[];
}

interface ZoneChangeRow {
  id: number;
  zone_id: number;
  action: ZoneChangeAction;
  before: string | null;
  after: string | null;
  created_at: string;
}

function parseZone(json: string | null): Zone | null {
  return json === null ? null : (JSON.parse(json) as Zone);
}

function toChange(row: ZoneChangeRow): ZoneChange {
  return {
    id: row.id,
    zoneId: row.zone_id,
    action: row.action,
    before: parseZone(row.before),
    after: parseZone(row.after),
    createdAt: row.created_at,
  };
}

/** Repositorio SQLite del registro de cambios de zona. Consultas parametrizadas (RF-04.1). */
export function createZoneChangeLogRepository(db: Db): ZoneChangeLogRepository {
  const insertStmt = db.prepare(
    `INSERT INTO zone_change_log (zone_id, action, before, after)
     VALUES (@zoneId, @action, @before, @after)`,
  );
  const listStmt = db.prepare<[], ZoneChangeRow>(
    `SELECT id, zone_id, action, before, after, created_at
     FROM zone_change_log ORDER BY id DESC`,
  );

  return {
    append({ zoneId, action, before, after }) {
      insertStmt.run({
        zoneId,
        action,
        before: before === null ? null : JSON.stringify(before),
        after: after === null ? null : JSON.stringify(after),
      });
    },
    listAll() {
      return listStmt.all().map(toChange);
    },
  };
}
