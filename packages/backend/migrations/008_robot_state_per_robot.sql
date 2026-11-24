-- Spec 002 — RC-01 (R12.1, R12.5, R10.5): estado y posición por robot.
-- Requiere la 007 (tabla robots). Reconstruye robot_state con robot_id como clave y FK a robots;
-- SQLite no permite cambiar la clave con ALTER TABLE, por lo que se usa el patrón CREATE new +
-- copiar + DROP + RENAME. Ninguna tabla referencia todavía robot_state, así que el DROP es seguro.
--
-- position_quality no tiene DEFAULT: toda inserción debe darla explícita (un robot sin lectura
-- no debe parecer confiable por omisión). Tampoco hay DEFAULT en el resto de columnas de estado.

CREATE TABLE robot_state_new (
  robot_id         INTEGER PRIMARY KEY REFERENCES robots(id),
  state            TEXT    NOT NULL
                   CHECK (state IN ('IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING')),
  pos_x            REAL    NOT NULL,
  pos_y            REAL    NOT NULL,
  position_quality TEXT    NOT NULL
                   CHECK (position_quality IN ('RELIABLE', 'UNRELIABLE', 'MISSING')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A1 (robot_id = 1): copia SIEMPRE la fila id = 1 tal cual (en una base nueva es (120, 90)),
-- sin lógica de detección de base nueva (Q-I).
INSERT INTO robot_state_new (robot_id, state, pos_x, pos_y, position_quality, updated_at)
SELECT 1, state, pos_x, pos_y, position_quality, updated_at FROM robot_state WHERE id = 1;

-- V2 (robot_id = 2): estado inicial en (488, 290).
INSERT INTO robot_state_new (robot_id, state, pos_x, pos_y, position_quality)
VALUES (2, 'IDLE', 488, 290, 'RELIABLE');

DROP TABLE robot_state;
ALTER TABLE robot_state_new RENAME TO robot_state;
