-- Spec 002 — HU-04/HU-05, R5.3: rechazos por estado (SAFE_STOP_ACTIVE | BUSY) append-only, sin incidente
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_code  TEXT    NOT NULL,   -- SAFE_STOP_ACTIVE | BUSY
  state       TEXT    NOT NULL,   -- estado en el momento del rechazo
  dest_x      REAL    NOT NULL,
  dest_y      REAL    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- R5.3: inmutable — la base rechaza cualquier UPDATE o DELETE (auditoría solo INSERT).
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
