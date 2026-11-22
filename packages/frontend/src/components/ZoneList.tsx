import type { Zone } from '../types';

interface ZoneListProps {
  zones: Zone[];
  busy?: boolean;
  onToggleActive: (zone: Zone) => void;
  onEdit: (zone: Zone) => void;
  onDelete: (zone: Zone) => void;
}

/**
 * Habitaciones con el switch del prototipo: encendido = restringida (zona activa).
 * Editar y eliminar cubren RF-02.2 y RF-02.4.
 */
export function ZoneList({ zones, busy = false, onToggleActive, onEdit, onDelete }: ZoneListProps) {
  if (zones.length === 0) return <div className="empty">No hay habitaciones registradas.</div>;

  return (
    <div role="list" aria-label="Habitaciones">
      {zones.map((z) => (
        <div key={z.id} role="listitem" className="zone-row" data-testid={`zone-row-${z.id}`}>
          <div>
            <b>{z.name}</b>
            <p>{z.active ? 'No se permite circular' : 'Circulación permitida'}</p>
          </div>
          <div className="zone-actions">
            <button
              type="button"
              className="btn tight"
              disabled={busy}
              aria-label={`Editar ${z.name}`}
              onClick={() => onEdit(z)}
            >
              Editar
            </button>
            <button
              type="button"
              className="btn tight danger"
              disabled={busy}
              aria-label={`Eliminar ${z.name}`}
              onClick={() => onDelete(z)}
            >
              Eliminar
            </button>
            <button
              type="button"
              className={`switch${z.active ? ' on' : ''}`}
              disabled={busy}
              aria-label={`${z.active ? 'Permitir' : 'Restringir'} ${z.name}`}
              aria-pressed={z.active}
              onClick={() => onToggleActive(z)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
