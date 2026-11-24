-- Spec 003 — RC-01 (RF-07.6, RF-08.5, DD-122): sesión vigente por robot (esquema único).
-- No es un registro: guarda solo la sesión vigente y se sobrescribe al iniciar otra; el historial
-- de sesiones queda en audit_log (SESSION_STARTED).
CREATE TABLE IF NOT EXISTS robot_sessions (
  robot_id           INTEGER PRIMARY KEY REFERENCES robots(id),
  session_id         TEXT    NOT NULL UNIQUE,          -- sesión vigente (UUID)
  last_sequence      INTEGER NOT NULL DEFAULT 0,       -- 0 = sin solicitudes aceptadas
  last_destination_x REAL,
  last_destination_y REAL,
  last_accepted_at   TEXT,                             -- ISO-8601 UTC
  started_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
