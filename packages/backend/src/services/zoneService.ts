import {
  classifyZoneUpdate,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  type UpdateZoneBody,
  type Zone,
  type ZoneActiveFilter,
  type ZoneChange,
  type ZoneInput,
} from '@home-guardian/domain';
import {
  invalidZoneDimensions,
  zoneNameDuplicate,
  zoneNotFound,
  zoneOutOfBounds,
} from '../errors/AppError.js';
import type { ZoneChangeLogRepository } from '../repositories/zoneChangeLogRepository.js';
import {
  DuplicateZoneNameError,
  type ZoneListFilter,
  type ZoneRepository,
} from '../repositories/zoneRepository.js';

/** RF-03.2 — CA-02.3 */
export function assertDimensions(z: ZoneInput): void {
  if (z.width <= 0 || z.height <= 0) throw invalidZoneDimensions();
}

/** RF-03.3 — CA-02.4 */
export function assertWithinFloor(z: ZoneInput): void {
  if (z.x < 0 || z.y < 0 || z.x + z.width > FLOOR_WIDTH || z.y + z.height > FLOOR_HEIGHT) {
    throw zoneOutOfBounds();
  }
}

const FILTER_BY_QUERY: Record<ZoneActiveFilter, ZoneListFilter> = {
  all: 'all',
  false: 'inactive',
};

export interface ZoneService {
  list(active?: ZoneActiveFilter): Zone[];
  get(id: number): Zone;
  create(input: ZoneInput): Zone;
  update(id: number, patch: UpdateZoneBody): Zone;
  remove(id: number): void;
  /** Historial de cambios, del más reciente al más antiguo (RF-05.6). */
  listChanges(): ZoneChange[];
}

/** Dependencias del servicio de zonas, inyectadas (DIP, DD-007, DD-011). */
export interface ZoneServiceDeps {
  zones: ZoneRepository;
  changes: ZoneChangeLogRepository;
  /** Ejecuta `fn` en una transacción `IMMEDIATE` (cambio + registro atómicos, RF-05.2). */
  runInTransaction: <T>(fn: () => T) => T;
}

/** Reglas de negocio de zonas. Cada cambio se registra en la misma transacción (RF-05). */
export function createZoneService(deps: ZoneServiceDeps): ZoneService {
  const { zones, changes, runInTransaction } = deps;

  const translateDuplicate = <T>(name: string, fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DuplicateZoneNameError) throw zoneNameDuplicate(name);
      throw err;
    }
  };

  const validate = (z: ZoneInput, exceptId?: number) => {
    assertDimensions(z);
    assertWithinFloor(z);
    if (zones.existsByName(z.name, exceptId)) throw zoneNameDuplicate(z.name);
  };

  return {
    list(active) {
      return zones.findAll(active ? FILTER_BY_QUERY[active] : 'active');
    },

    get(id) {
      const zone = zones.findById(id);
      if (!zone) throw zoneNotFound(id);
      return zone;
    },

    create(input) {
      return runInTransaction(() => {
        validate(input);
        // La BD sigue siendo la autoridad de unicidad ante carreras (DD-006).
        const created = translateDuplicate(input.name, () => zones.create(input));
        changes.append({ zoneId: created.id, action: 'CREATE', before: null, after: created });
        return created;
      });
    },

    update(id, patch) {
      return runInTransaction(() => {
        const current = zones.findById(id);
        if (!current) throw zoneNotFound(id);
        const merged: ZoneInput = {
          name: patch.name ?? current.name,
          x: patch.x ?? current.x,
          y: patch.y ?? current.y,
          width: patch.width ?? current.width,
          height: patch.height ?? current.height,
          active: patch.active ?? current.active,
        };
        validate(merged, id);
        const updated = translateDuplicate(merged.name, () => zones.update(id, merged));
        if (!updated) throw zoneNotFound(id);
        // RF-05.3: un PUT que no cambia nada no deja fila.
        const action = classifyZoneUpdate(current, updated);
        if (action !== null) {
          changes.append({ zoneId: id, action, before: current, after: updated });
        }
        return updated;
      });
    },

    remove(id) {
      runInTransaction(() => {
        const current = zones.findById(id);
        if (!current) throw zoneNotFound(id);
        if (!zones.delete(id)) throw zoneNotFound(id);
        changes.append({ zoneId: id, action: 'DELETE', before: current, after: null });
      });
    },

    listChanges() {
      return changes.listAll();
    },
  };
}
