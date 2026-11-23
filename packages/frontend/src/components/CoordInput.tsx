import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@home-guardian/domain';
import { useId, type FormEvent } from 'react';
import type { Point } from '../types';

/** Texto de los campos X e Y; el clic en el plano también los rellena (CA-03.7). */
export interface CoordDraft {
  x: string;
  y: string;
}

export const emptyDraft: CoordDraft = { x: '', y: '' };

export const toDraft = (p: Point): CoordDraft => ({
  x: String(p.x),
  y: String(p.y),
});

export interface ParsedDestination {
  point: Point | null;
  error: string | null;
}

/**
 * Validación de entrada (no es una regla de seguridad): números finitos y dentro del plano,
 * con borde inclusivo (RF-01.4). Fuera del plano se impide el envío (RF-01.5); el backend
 * sigue siendo la autoridad y responde 422 DESTINATION_OUT_OF_BOUNDS.
 */
export function parseDestination({ x, y }: CoordDraft): ParsedDestination {
  if (x.trim() === '' && y.trim() === '') return { point: null, error: null };
  const nx = x.trim() === '' ? NaN : Number(x);
  const ny = y.trim() === '' ? NaN : Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return { point: null, error: 'Escriba valores numéricos para X e Y' };
  }
  if (nx < 0 || ny < 0 || nx > FLOOR_WIDTH || ny > FLOOR_HEIGHT) {
    return {
      point: null,
      error: `El destino debe estar dentro del plano (0–${FLOOR_WIDTH}, 0–${FLOOR_HEIGHT})`,
    };
  }
  return { point: { x: nx, y: ny }, error: null };
}

interface CoordInputProps {
  value: CoordDraft;
  onChange: (draft: CoordDraft) => void;
  /** Recibe el mismo `Point` que produce un clic en el plano (RF-01.3). */
  onSubmit: (destination: Point) => void;
  submitting?: boolean;
}

/** Destino por coordenadas (RF-01.2). */
export function CoordInput({ value, onChange, onSubmit, submitting = false }: CoordInputProps) {
  const id = useId();
  const { point, error } = parseDestination(value);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (point) onSubmit(point);
  };

  return (
    <form aria-label="Destino del robot" onSubmit={handleSubmit} noValidate>
      <div className="coord-row">
        {(['x', 'y'] as const).map((axis) => (
          <div key={axis}>
            <label className="label" htmlFor={`${id}-${axis}`}>
              Destino {axis.toUpperCase()}
            </label>
            <input
              id={`${id}-${axis}`}
              className="field"
              name={axis}
              type="number"
              inputMode="decimal"
              placeholder={axis === 'x' ? `0 – ${FLOOR_WIDTH}` : `0 – ${FLOOR_HEIGHT}`}
              value={value[axis]}
              aria-invalid={error ? true : undefined}
              onChange={(e) => onChange({ ...value, [axis]: e.target.value })}
            />
          </div>
        ))}
        <button type="submit" className="btn primary" disabled={!point || submitting}>
          ▶ Solicitar movimiento
        </button>
      </div>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : (
        <p className="note-line">Haga clic en el plano o escriba las coordenadas del destino.</p>
      )}
    </form>
  );
}
