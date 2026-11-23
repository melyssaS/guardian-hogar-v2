import type {
  CollisionType,
  DecisionCode,
  Point,
  RobotStateName,
  Zone,
} from '@home-guardian/domain';
import type { Db } from '../db/connection.js';

/**
 * Datos de un incidente a persistir (spec 002 §4 paso 6, R5.2).
 * El servicio crea un incidente cuando una denegación conduce a parada preventiva.
 */
export interface IncidentInput {
  decisionCode: DecisionCode;
  /** Causa geométrica; `null` en denegaciones por datos. */
  collisionType: CollisionType | null;
  stateAfter: RobotStateName;
  origin: Point;
  destination: Point;
  /** Zonas usadas en la decisión; se serializan a JSON al insertar (DD-205). */
  zonesSnapshot: Zone[];
  reason: string;
}

/** Incidente persistido e inmutable (spec 002 §Data Models, R5.4). */
export interface Incident {
  id: number;
  decisionCode: DecisionCode;
  collisionType: CollisionType | null;
  stateAfter: RobotStateName;
  origin: Point;
  destination: Point;
  /** Zonas de la decisión, parseadas desde el JSON almacenado. */
  zonesSnapshot: Zone[];
  reason: string;
  /** ISO-8601 */
  createdAt: string;
}

/** Registro append-only: solo inserción y listado (R5.4, DD-205). */
export interface IncidentRepository {
  create(input: IncidentInput): Incident;
  findAll(): Incident[];
}

interface IncidentRow {
  id: number;
  decision_code: string;
  collision_type: string | null;
  state_after: string;
  origin_x: number;
  origin_y: number;
  dest_x: number;
  dest_y: number;
  zones_snapshot: string;
  reason: string;
  created_at: string;
}

/** Parsea el JSON de zonas sin usar `any`, asumiendo lo escrito por `create`. */
function parseZones(json: string): Zone[] {
  return JSON.parse(json) as Zone[];
}

function toIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    decisionCode: row.decision_code as DecisionCode,
    collisionType: row.collision_type as CollisionType | null,
    stateAfter: row.state_after as RobotStateName,
    origin: { x: row.origin_x, y: row.origin_y },
    destination: { x: row.dest_x, y: row.dest_y },
    zonesSnapshot: parseZones(row.zones_snapshot),
    reason: row.reason,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Repositorio SQLite de incidentes. Todas las consultas son parametrizadas (RF-04.1). */
export function createIncidentRepository(db: Db): IncidentRepository {
  const insertStmt = db.prepare(
    `INSERT INTO incidents
       (decision_code, collision_type, state_after, origin_x, origin_y, dest_x, dest_y,
        zones_snapshot, reason)
     VALUES
       (@decisionCode, @collisionType, @stateAfter, @originX, @originY, @destX, @destY,
        @zonesSnapshot, @reason)`,
  );
  const findByIdStmt = db.prepare('SELECT * FROM incidents WHERE id = ?');
  const findAllStmt = db.prepare<[], IncidentRow>('SELECT * FROM incidents ORDER BY id');

  const findById = (id: number): Incident => {
    const row = findByIdStmt.get(id) as IncidentRow;
    return toIncident(row);
  };

  return {
    create(input) {
      const result = insertStmt.run({
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
      return findById(Number(result.lastInsertRowid));
    },
    findAll() {
      return findAllStmt.all().map(toIncident);
    },
  };
}
