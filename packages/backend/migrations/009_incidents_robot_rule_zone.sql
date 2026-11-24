-- Spec 002 — RC-01 (R5.5, R5.9): el incidente guarda el robot, la regla y la zona implicada.
-- Las filas antiguas quedan con NULL (la tabla es append-only: no se reescriben); el repositorio
-- deriva `rule` del `decision_code` al leerlas y devuelve `robotId: null`.
-- `decision_code` no tiene CHECK (POSITION_QUALITY_LOST lo valida el tipo IncidentCode).
-- ADD COLUMN conserva los triggers append-only de la 004.
ALTER TABLE incidents ADD COLUMN robot_id  INTEGER REFERENCES robots(id);
ALTER TABLE incidents ADD COLUMN rule      TEXT;
ALTER TABLE incidents ADD COLUMN zone_name TEXT;
