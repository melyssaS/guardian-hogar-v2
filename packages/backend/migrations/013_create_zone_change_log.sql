-- Spec 001 — RC-01, RF-05, DD-010/DD-012: registro inmutable de cambios de zona.
-- Numeración fijada en la unificación RC-01: se entrega en U2, después de 007-012.
CREATE TABLE IF NOT EXISTS zone_change_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id    INTEGER NOT NULL,                -- sin FK: el historial sobrevive al DELETE de la zona
  action     TEXT    NOT NULL
             CHECK (action IN ('CREATE','UPDATE','ACTIVATE','DEACTIVATE','DELETE')),
  before     TEXT,                            -- JSON de la Zone; NULL en CREATE
  after      TEXT,                            -- JSON de la Zone; NULL en DELETE
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (action <> 'CREATE' OR before IS NULL),
  CHECK (action <> 'DELETE' OR after IS NULL)
);

-- RF-05.5 / RNF-06: inmutable — la base rechaza cualquier UPDATE o DELETE (solo INSERT).
CREATE TRIGGER IF NOT EXISTS zone_change_log_no_update
BEFORE UPDATE ON zone_change_log
BEGIN
  SELECT RAISE(ABORT, 'zone_change_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS zone_change_log_no_delete
BEFORE DELETE ON zone_change_log
BEGIN
  SELECT RAISE(ABORT, 'zone_change_log is append-only');
END;
