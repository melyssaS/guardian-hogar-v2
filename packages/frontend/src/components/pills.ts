import type { PositionQuality, RobotStateName, RobotType } from '../types';

/** Clases de presentación por estado y calidad: traducen lo que devuelve la API (RF-04.6). */
export const STATE_PILL: Record<RobotStateName, string> = {
  IDLE: 'pill success',
  MOVING: 'pill blue',
  SAFE_STOP: 'pill danger',
  DEGRADED: 'pill gray',
  RECOVERING: 'pill warn',
};

export const QUALITY_PILL: Record<PositionQuality, string> = {
  RELIABLE: 'pill success',
  UNRELIABLE: 'pill warn',
  MISSING: 'pill danger',
};

/** Etiqueta en español del tipo de robot. */
export const TYPE_LABEL: Record<RobotType, string> = {
  VACUUM: 'Aspiradora',
  GUARD: 'Vigilante',
};
