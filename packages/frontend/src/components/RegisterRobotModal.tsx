import { useState, type FormEvent } from 'react';
import type { RobotInput, RobotType } from '../types';
import { TYPE_LABEL } from './pills';

interface RegisterRobotModalProps {
  submitting: boolean;
  /** Error de la API del último intento, tal como llega (`mensaje (CÓDIGO: causa)`). */
  error: string | null;
  /** Devuelve `true` si la API creó el robot (el modal se cierra desde el padre). */
  onSubmit: (input: RobotInput) => Promise<boolean>;
  onClose: () => void;
}

/**
 * Modal "Registrar robot": solo nombre y tipo. No valida reglas de negocio ni de posición:
 * el servidor responde 422/409 y la UI muestra el código (RF-07.8, CA-03.10, CA-03.22, CA-03.35).
 */
export function RegisterRobotModal({
  submitting,
  error,
  onSubmit,
  onClose,
}: RegisterRobotModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<RobotType>('VACUUM');
  // El error del hook puede venir de un intento anterior: solo se muestra tras enviar aquí.
  const [attempted, setAttempted] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    await onSubmit({ name, type });
  };

  return (
    <div className="modalwrap open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Registrar robot simulado">
        <h3>Registrar robot de prueba</h3>
        <p>
          El robot nace en la posición inicial del plano, en estado IDLE. El servidor valida el
          nombre y la posición inicial.
        </p>
        {/* noValidate: required/maxLength son solo ayuda de UX; la autoridad es el 422 de la API. */}
        <form noValidate onSubmit={(e) => void submit(e)}>
          <label className="label" htmlFor="robot-name-input">
            Nombre del robot
          </label>
          <input
            id="robot-name-input"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Aspiradora del pasillo"
            autoFocus
            required
            maxLength={60}
          />
          <div style={{ height: 13 }} />
          <label className="label" htmlFor="robot-type-input">
            Tipo
          </label>
          <select
            id="robot-type-input"
            className="field"
            value={type}
            onChange={(e) => setType(e.target.value as RobotType)}
          >
            {(Object.keys(TYPE_LABEL) as RobotType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {attempted && error && (
            <div role="alert" className="callout error" style={{ marginTop: 14 }}>
              {error}
            </div>
          )}
          <div className="controls modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              Registrar en simulación
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
