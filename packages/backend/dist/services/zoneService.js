import { FLOOR_HEIGHT, FLOOR_WIDTH, } from '@home-guardian/domain';
import { invalidZoneDimensions, zoneNameDuplicate, zoneNotFound, zoneOutOfBounds, } from '../errors/AppError.js';
import { DuplicateZoneNameError, } from '../repositories/zoneRepository.js';
/** RF-03.2 — CA-02.3 */
export function assertDimensions(z) {
    if (z.width <= 0 || z.height <= 0)
        throw invalidZoneDimensions();
}
/** RF-03.3 — CA-02.4 */
export function assertWithinFloor(z) {
    if (z.x < 0 || z.y < 0 || z.x + z.width > FLOOR_WIDTH || z.y + z.height > FLOOR_HEIGHT) {
        throw zoneOutOfBounds();
    }
}
const FILTER_BY_QUERY = {
    all: 'all',
    false: 'inactive',
};
/** Reglas de negocio de zonas. El repositorio se inyecta (DIP, DD-007). */
export function createZoneService(repo) {
    const translateDuplicate = (name, fn) => {
        try {
            return fn();
        }
        catch (err) {
            if (err instanceof DuplicateZoneNameError)
                throw zoneNameDuplicate(name);
            throw err;
        }
    };
    const validate = (z, exceptId) => {
        assertDimensions(z);
        assertWithinFloor(z);
        if (repo.existsByName(z.name, exceptId))
            throw zoneNameDuplicate(z.name);
    };
    return {
        list(active) {
            return repo.findAll(active ? FILTER_BY_QUERY[active] : 'active');
        },
        get(id) {
            const zone = repo.findById(id);
            if (!zone)
                throw zoneNotFound(id);
            return zone;
        },
        create(input) {
            validate(input);
            // La BD sigue siendo la autoridad de unicidad ante carreras (DD-006).
            return translateDuplicate(input.name, () => repo.create(input));
        },
        update(id, patch) {
            const current = repo.findById(id);
            if (!current)
                throw zoneNotFound(id);
            const merged = {
                name: patch.name ?? current.name,
                x: patch.x ?? current.x,
                y: patch.y ?? current.y,
                width: patch.width ?? current.width,
                height: patch.height ?? current.height,
                active: patch.active ?? current.active,
            };
            validate(merged, id);
            const updated = translateDuplicate(merged.name, () => repo.update(id, merged));
            if (!updated)
                throw zoneNotFound(id);
            return updated;
        },
        remove(id) {
            if (!repo.delete(id))
                throw zoneNotFound(id);
        },
    };
}
