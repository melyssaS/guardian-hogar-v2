-- Spec 003 — HU-03, RF-05, DD-105: registro append-only de decisiones del vigilante
CREATE TABLE IF NOT EXISTS movement_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  decision       TEXT    NOT NULL,
  state_after    TEXT    NOT NULL,
  origin_x       REAL    NOT NULL,
  origin_y       REAL    NOT NULL,
  dest_x         REAL    NOT NULL,
  dest_y         REAL    NOT NULL,
  collision_type TEXT,
  zone_name      TEXT,
  reason         TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- RF-05.2: inmutable — la base rechaza cualquier UPDATE o DELETE.
CREATE TRIGGER IF NOT EXISTS movement_log_no_update
BEFORE UPDATE ON movement_log
BEGIN
  SELECT RAISE(ABORT, 'movement_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS movement_log_no_delete
BEFORE DELETE ON movement_log
BEGIN
  SELECT RAISE(ABORT, 'movement_log is append-only');
END;
