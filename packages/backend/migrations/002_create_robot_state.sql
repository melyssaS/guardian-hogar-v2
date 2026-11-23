-- Spec 003 — HU-03, RF-02.1, DD-103: estado y posición del robot (fila única, autoridad backend)
CREATE TABLE IF NOT EXISTS robot_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  state      TEXT    NOT NULL DEFAULT 'IDLE' CHECK (state IN ('IDLE', 'MOVING', 'SAFE_STOP')),
  pos_x      REAL    NOT NULL DEFAULT 0,
  pos_y      REAL    NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Posición inicial: en la Sala del prototipo (ejemplo del contrato de API, spec 003 §5).
INSERT OR IGNORE INTO robot_state (id, state, pos_x, pos_y) VALUES (1, 'IDLE', 120, 90);
