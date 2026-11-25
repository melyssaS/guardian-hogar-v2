import {
  ruleForDecision,
  severityForDecision,
  type CollisionType,
  type Incident,
  type IncidentCode,
  type IncidentDetail,
  type Point,
  type RobotId,
  type RobotStateName,
  type RuleId,
  type Severity,
  type Zone,
} from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/**
 * Datos de un incidente a persistir (spec 002 §4 paso 6, R5.2, R5.5). Las filas nuevas exigen
 * `robotId` y `rule` (la regla incumplida del catálogo `RULES`, spec 001); `zoneName` solo se
 * rellena en denegaciones geométricas.
 */
export interface IncidentInput {
  robotId: RobotId;
  rule: RuleId;
  /** Zona implicada en la denegación geométrica; `null` en causas de datos. */
  zoneName: string | null;
  decisionCode: IncidentCode;
  /** Causa geométrica; `null` en denegaciones por datos. */
  collisionType: CollisionType | null;
  stateAfter: RobotStateName;
  origin: Point;
  destination: Point;
  /** Zonas usadas en la decisión; se serializan a JSON al insertar (DD-205). */
  zonesSnapshot: Zone[];
  reason: string;
}

/**
 * Filtros opcionales de `findAll` (GET /api/incidents?robotId=&severity=). La severidad no es una
 * columna: se deriva del `decision_code` (spec 006 DD-601), así que se filtra tras mapear.
 */
export interface IncidentFilter {
  robotId?: RobotId;
  severity?: Severity;
}

/** Registro append-only: solo inserción y lectura (R5.4, DD-205). */
export interface IncidentRepository {
  create(input: IncidentInput): IncidentDetail;
  /** Resumen del más reciente al más antiguo, opcionalmente de un solo robot. */
  findAll(filter?: IncidentFilter): Incident[];
  /** Detalle con `zonesSnapshot`; `null` si no existe. */
  findById(id: number): IncidentDetail | null;
}

/** Fila de `incidents` unida con el nombre del robot (filas antiguas: NULL en robot/rule/zona). */
interface IncidentRow {
  id: number;
  robot_id: number | null;
  robot_name: string | null;
  rule: RuleId | null;
  zone_name: string | null;
  decision_code: IncidentCode;
  collision_type: CollisionType | null;
  state_after: RobotStateName;
  origin_x: number;
  origin_y: number;
  dest_x: number;
  dest_y: number;
  zones_snapshot: string;
  reason: string;
  created_at: string;
}

/** Las filas anteriores a la 011 usan `datetime('now')` (UTC sin zona): se normalizan a ISO. */
function toIso(value: string): string {
  const legacy = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  return new Date(legacy ? `${value.replace(' ', 'T')}Z` : value).toISOString();
}

/** Resumen sin `zonesSnapshot`. En filas antiguas la regla se deriva del `decision_code`. */
function toIncident(row: IncidentRow): Incident {
  const rule = row.rule ?? ruleForDecision(row.decision_code);
  if (rule === null) throw new Error(`incident ${row.id} has no rule for ${row.decision_code}`);
  return {
    id: row.id,
    robotId: row.robot_id,
    robotName: row.robot_name,
    rule,
    zoneName: row.zone_name,
    decisionCode: row.decision_code,
    severity: severityForDecision(row.decision_code),
    collisionType: row.collision_type,
    stateAfter: row.state_after,
    origin: { x: row.origin_x, y: row.origin_y },
    destination: { x: row.dest_x, y: row.dest_y },
    reason: row.reason,
    createdAt: toIso(row.created_at),
  };
}

function toDetail(row: IncidentRow): IncidentDetail {
  return { ...toIncident(row), zonesSnapshot: JSON.parse(row.zones_snapshot) as Zone[] };
}

const SELECT = `SELECT i.id, i.robot_id, r.name AS robot_name, i.rule, i.zone_name, i.decision_code,
                       i.collision_type, i.state_after, i.origin_x, i.origin_y, i.dest_x, i.dest_y,
                       i.zones_snapshot, i.reason, i.created_at
                FROM incidents i LEFT JOIN robots r ON r.id = i.robot_id`;

/** Repositorio SQLite de incidentes. Todas las consultas son parametrizadas (RF-04.1). */
export function createIncidentRepository(db: Db): IncidentRepository {
  const insertStmt = db.prepare(
    `INSERT INTO incidents
       (robot_id, rule, zone_name, decision_code, collision_type, state_after, origin_x, origin_y,
        dest_x, dest_y, zones_snapshot, reason)
     VALUES
       (@robotId, @rule, @zoneName, @decisionCode, @collisionType, @stateAfter, @originX, @originY,
        @destX, @destY, @zonesSnapshot, @reason)`,
  );
  const findByIdStmt = db.prepare<[number], IncidentRow>(`${SELECT} WHERE i.id = ?`);
  const findAllStmt = db.prepare<[], IncidentRow>(`${SELECT} ORDER BY i.id DESC`);
  const findByRobotStmt = db.prepare<[number], IncidentRow>(
    `${SELECT} WHERE i.robot_id = ? ORDER BY i.id DESC`,
  );

  return {
    create(input) {
      // R5.5: las filas nuevas exigen robot y regla (las antiguas conservan NULL).
      if (!Number.isInteger(input.robotId)) throw new Error('incident requires a robotId');
      if (!input.rule) throw new Error('incident requires a rule');
      const result = insertStmt.run({
        robotId: input.robotId,
        rule: input.rule,
        zoneName: input.zoneName,
        decisionCode: input.decisionCode,
        collisionType: input.collisionType ?? null,
        stateAfter: input.stateAfter,
        originX: input.origin.x,
        originY: input.origin.y,
        destX: input.destination.x,
        destY: input.destination.y,
        zonesSnapshot: JSON.stringify(input.zonesSnapshot),
        reason: input.reason,
      });
      const row = findByIdStmt.get(Number(result.lastInsertRowid));
      if (!row) throw new Error('incident insert did not persist');
      return toDetail(row);
    },
    findAll(filter) {
      const rows =
        filter?.robotId === undefined ? findAllStmt.all() : findByRobotStmt.all(filter.robotId);
      const incidents = rows.map(toIncident);
      return filter?.severity === undefined
        ? incidents
        : incidents.filter((i) => i.severity === filter.severity);
    },
    findById(id) {
      const row = findByIdStmt.get(id);
      return row ? toDetail(row) : null;
    },
  };
}
