-- Spec 003 — RC-01 (RF-07.3, RF-07.5, DD-110): catálogo de robots.
-- El estado y la posición no viven aquí: los crea la migración 008 (spec 002) por robot.
CREATE TABLE IF NOT EXISTS robots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 60),
  type       TEXT    NOT NULL CHECK (type IN ('VACUUM', 'GUARD')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Robots del prototipo: A1 (id 1) y V2 (id 2). Sin UPDATE encubiertos.
INSERT OR IGNORE INTO robots (id, name, type) VALUES (1, 'Aspiradora A1', 'VACUUM');
INSERT OR IGNORE INTO robots (id, name, type) VALUES (2, 'Vigilante V2', 'GUARD');
