import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@home-guardian/domain';
import { useId, useState, type FormEvent } from 'react';
import type { Zone, ZoneInput } from '../types';

interface ZoneFormProps {
  /** Zona a editar; sin ella el formulario crea una nueva. */
  initial?: Zone;
  submitting?: boolean;
  onSubmit: (input: ZoneInput) => Promise<boolean> | boolean;
  onCancel?: () => void;
}

type Field = 'name' | 'x' | 'y' | 'width' | 'height';
type Values = Record<Field, string> & { active: boolean };
type Errors = Partial<Record<Field | 'bounds', string>>;

const empty: Values = { name: '', x: '0', y: '0', width: '100', height: '100', active: true };

function toValues(z?: Zone): Values {
  if (!z) return empty;
  return {
    name: z.name,
    x: String(z.x),
    y: String(z.y),
    width: String(z.width),
    height: String(z.height),
    active: z.active,
  };
}

/** Validación visual; el backend sigue siendo la autoridad (RF-03). */
export function validateZoneForm(v: Values): Errors {
  const errors: Errors = {};
  if (v.name.trim() === '') errors.name = 'El nombre es obligatorio';
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const [x, y, w, h] = [n(v.x), n(v.y), n(v.width), n(v.height)];
  if (!Number.isFinite(x)) errors.x = 'Debe ser un número';
  if (!Number.isFinite(y)) errors.y = 'Debe ser un número';
  if (!Number.isFinite(w) || w <= 0) errors.width = 'Debe ser mayor que 0';
  if (!Number.isFinite(h) || h <= 0) errors.height = 'Debe ser mayor que 0';
  if (
    Object.keys(errors).length === 0 &&
    (x < 0 || y < 0 || x + w > FLOOR_WIDTH || y + h > FLOOR_HEIGHT)
  ) {
    errors.bounds = `La zona debe quedar dentro del plano ${FLOOR_WIDTH} × ${FLOOR_HEIGHT}`;
  }
  return errors;
}

const fields: Array<{ key: Field; label: string; full?: boolean }> = [
  { key: 'name', label: 'Nombre', full: true },
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'Ancho' },
  { key: 'height', label: 'Alto' },
];

export function ZoneForm({ initial, submitting = false, onSubmit, onCancel }: ZoneFormProps) {
  const id = useId();
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const [errors, setErrors] = useState<Errors>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateZoneForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const ok = await onSubmit({
      name: values.name.trim(),
      x: Number(values.x),
      y: Number(values.y),
      width: Number(values.width),
      height: Number(values.height),
      active: values.active,
    });
    if (ok && !initial) setValues(empty);
  };

  return (
    <form
      className="card pad"
      aria-label={initial ? 'Editar zona' : 'Nueva zona'}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="section-heading">
        <div>
          <h2 className="card-title">
            {initial ? `Editar «${initial.name}»` : 'Nueva habitación'}
          </h2>
          <p className="card-sub">
            Coordenadas en unidades del plano {FLOOR_WIDTH} × {FLOOR_HEIGHT}, origen arriba a la
            izquierda
          </p>
        </div>
      </div>
      <div className="form-grid">
        {fields.map(({ key, label, full }) => (
          <div key={key} className={full ? 'full' : undefined}>
            <label className="label" htmlFor={`${id}-${key}`}>
              {label}
            </label>
            <input
              id={`${id}-${key}`}
              className="field"
              name={key}
              type={key === 'name' ? 'text' : 'number'}
              value={values[key]}
              aria-invalid={errors[key] ? true : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            />
            {errors[key] && (
              <span role="alert" className="field-error">
                {errors[key]}
              </span>
            )}
          </div>
        ))}
        <label className="full" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={values.active}
            onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
          />
          <span className="label" style={{ margin: 0 }}>
            Zona restringida
          </span>
        </label>
      </div>
      {errors.bounds && (
        <p role="alert" className="field-error">
          {errors.bounds}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={submitting}>
          {initial ? 'Guardar cambios' : 'Crear zona'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
