import { createZoneRepository } from '../repositories/zoneRepository.js';
import { migrate } from './migrate.js';
/**
 * Habitaciones del prototipo (Guardian_Hogar_Artifact_V2). Una zona activa es una habitación
 * restringida; una inactiva es un área permitida.
 */
export const DEFAULT_ROOMS = [
    { name: 'Sala', x: 29, y: 30, width: 250, height: 178, active: false },
    { name: 'Cocina', x: 296, y: 30, width: 270, height: 178, active: false },
    { name: 'Escaleras', x: 29, y: 226, width: 160, height: 178, active: true },
    { name: 'Cuarto del bebé', x: 206, y: 226, width: 187, height: 178, active: true },
    { name: 'Pasillo', x: 410, y: 226, width: 156, height: 178, active: false },
];
/** Inserta las habitaciones por defecto en una sola transacción. */
export function seedDefaultRooms(db) {
    const repo = createZoneRepository(db);
    db.transaction(() => {
        for (const room of DEFAULT_ROOMS)
            repo.create(room);
    })();
}
/**
 * Aplica migraciones y siembra las habitaciones solo cuando se acaba de crear la tabla
 * `zones`. Así los arranques posteriores conservan los cambios del operador.
 */
export function initDatabase(db) {
    const applied = migrate(db);
    if (applied.includes('001_create_zones.sql'))
        seedDefaultRooms(db);
}
