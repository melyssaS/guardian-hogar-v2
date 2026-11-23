-- Spec 002 — HU-04/HU-05, R5.1/R5.4, DD-205: incidentes append-only con zones_snapshot JSON
CREATE TABLE IF NOT EXISTS incidents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_code  TEXT    NOT NULL,   -- ORIGIN_IN_RESTRICTED_ZONE | ... | ZONE_DATA_UNAVAILABLE
  collision_type TEXT,               -- nullable (null en causas de datos)
  state_after    TEXT    NOT NULL,
  origin_x       REAL    NOT NULL,
  origin_y       REAL    NOT NULL,
  dest_x         REAL    NOT NULL,
  dest_y         REAL    NOT NULL,
  zones_snapshot TEXT    NOT NULL,   -- JSON con las zonas usadas en la decisión
  reason         TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- R5.4: inmutable — la base rechaza cualquier UPDATE o DELETE (incidentes solo INSERT).
CREATE TRIGGER IF NOT EXISTS incidents_no_update
BEFORE UPDATE ON incidents
BEGIN
  SELECT RAISE(ABORT, 'incidents is append-only');
END;

CREATE TRIGGER IF NOT EXISTS incidents_no_delete
BEFORE DELETE ON incidents
BEGIN
  SELECT RAISE(ABORT, 'incidents is append-only');
END;
