-- Spec 002 — RC-01 (R5.8–R5.10, R8.7): audit_log generalizado a todos los rechazos y eventos.
-- Reconstruye la tabla (patrón CREATE new + copiar + DROP + RENAME) porque SQLite no permite
-- cambiar la nulabilidad ni los CHECK con ALTER TABLE. Ninguna tabla referencia audit_log.
--
-- Las filas antiguas (SAFE_STOP_ACTIVE / BUSY de la 006) se copian SIN modificarlas y con
-- robot_id NULL: no se atribuyen a A1 (art. XV). Un CHECK de tabla también se aplicaría a las
-- filas copiadas, por eso la regla para las filas NUEVAS es un trigger BEFORE INSERT creado
-- después de la copia.

CREATE TABLE audit_log_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id   INTEGER REFERENCES robots(id),
  event_code TEXT    NOT NULL CHECK (event_code IN (
               'SAFE_STOP_ACTIVE', 'BUSY', 'INVALID_SESSION', 'DUPLICATE_EVENT',
               'SESSION_STARTED', 'RECOVER_NOOP', 'RECOVERY_NOT_ALLOWED',
               'POSITION_READING', 'POSITION_CONFLICT',
               'ROBOT_START_IN_RESTRICTED_ZONE', 'ROBOT_START_NOT_VERIFIABLE')),
  state      TEXT,
  x          REAL,
  y          REAL,
  detail     TEXT,  -- JSON opcional
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO audit_log_new (id, robot_id, event_code, state, x, y, detail, created_at)
SELECT id, NULL, event_code, state, dest_x, dest_y, NULL, created_at FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;

-- Filas nuevas: robot_id y state obligatorios salvo en los dos rechazos de alta, que ocurren
-- antes de que el robot exista.
CREATE TRIGGER audit_log_require_robot_and_state
BEFORE INSERT ON audit_log
WHEN (NEW.robot_id IS NULL OR NEW.state IS NULL)
  AND NEW.event_code NOT IN ('ROBOT_START_IN_RESTRICTED_ZONE', 'ROBOT_START_NOT_VERIFIABLE')
BEGIN
  SELECT RAISE(ABORT, 'audit_log requires robot_id and state for this event_code');
END;

-- R5.3: inmutable — la base rechaza cualquier UPDATE o DELETE (auditoría solo INSERT).
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
