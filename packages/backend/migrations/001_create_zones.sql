-- Spec 001 — HU-02, RF-04.2, DD-006
CREATE TABLE IF NOT EXISTS zones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  width      REAL    NOT NULL,
  height     REAL    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
