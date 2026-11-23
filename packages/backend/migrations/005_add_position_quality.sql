-- Spec 002 — HU-06, R6.1, R6.3, ADR-10: calidad de posición y estados ampliados del robot.
--
-- Esta spec añade los estados DEGRADED y RECOVERING (requirements §2.1) y la columna
-- position_quality. El CHECK original de robot_state (spec 003) solo admite
-- IDLE/MOVING/SAFE_STOP, y SQLite no puede alterar un CHECK con ALTER TABLE. Por eso
-- reconstruimos la tabla (patrón estándar CREATE new + copiar + DROP + RENAME): así se
-- amplía el CHECK de state y se agrega position_quality en una sola migración.
--
-- R6.1: la fila sembrada (id=1) queda con position_quality='RELIABLE' para que el robot
-- pueda moverse desde el primer uso. El DEFAULT 'MISSING' solo aplica a filas no sembradas;
-- solo una señal de pérdida explícita (POST /api/robot/position) lo cambia (ADR-10).

CREATE TABLE robot_state_new (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  state            TEXT    NOT NULL DEFAULT 'IDLE'
                   CHECK (state IN ('IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING')),
  pos_x            REAL    NOT NULL DEFAULT 0,
  pos_y            REAL    NOT NULL DEFAULT 0,
  position_quality TEXT    NOT NULL DEFAULT 'MISSING'
                   CHECK (position_quality IN ('RELIABLE', 'UNRELIABLE', 'MISSING')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Copia la fila existente; el robot sembrado (id=1) arranca con posición confiable (R6.1).
INSERT INTO robot_state_new (id, state, pos_x, pos_y, position_quality, updated_at)
SELECT id, state, pos_x, pos_y, 'RELIABLE', updated_at FROM robot_state;

DROP TABLE robot_state;
ALTER TABLE robot_state_new RENAME TO robot_state;
