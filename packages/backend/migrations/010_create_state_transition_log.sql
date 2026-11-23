-- Spec 002 — RC-01 (R9.1, R9.7, R9.8, R5.9): registro append-only de transiciones de estado.
CREATE TABLE IF NOT EXISTS state_transition_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id   INTEGER NOT NULL REFERENCES robots(id),
  from_state TEXT CHECK (from_state IS NULL OR from_state IN
               ('IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING')),
  to_state   TEXT NOT NULL CHECK (to_state IN
               ('IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING')),
  cause      TEXT NOT NULL CHECK (cause IN (
               'AUTHORIZED', 'MOVE_COMPLETED',
               'ORIGIN_IN_RESTRICTED_ZONE', 'RESTRICTED_ZONE_VIOLATION', 'TRAJECTORY_CROSSES_ZONE',
               'INSUFFICIENT_DATA', 'MISSING_POSITION', 'ZONE_DATA_UNAVAILABLE',
               'RECOVER_REQUESTED', 'RECOVER_COMPLETED',
               'POSITION_QUALITY_LOST', 'BOOTSTRAP_MOVING_PERSISTED', 'ROBOT_REGISTERED',
               'MIGRATION_BASELINE')),
  detail     TEXT,  -- JSON opcional: destino/sesión/secuencia, incidentId, snapshot de zonas
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_state IS NOT NULL OR cause IN ('ROBOT_REGISTERED', 'MIGRATION_BASELINE'))
);

-- R5.9: inmutable — la base rechaza cualquier UPDATE o DELETE.
CREATE TRIGGER IF NOT EXISTS state_transition_log_no_update
BEFORE UPDATE ON state_transition_log
BEGIN
  SELECT RAISE(ABORT, 'state_transition_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS state_transition_log_no_delete
BEFORE DELETE ON state_transition_log
BEGIN
  SELECT RAISE(ABORT, 'state_transition_log is append-only');
END;

-- R9.8: fila base por cada robot existente. Es un evento real (la creación del registro),
-- no un historial fabricado: no se añaden transiciones retroactivas.
INSERT INTO state_transition_log (robot_id, from_state, to_state, cause)
SELECT robot_id, NULL, state, 'MIGRATION_BASELINE' FROM robot_state ORDER BY robot_id;
