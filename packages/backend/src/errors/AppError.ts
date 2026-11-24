import type { RecoveryRejectionCause } from '@home-guardian/domain';

/**
 * Error de dominio con status HTTP y `code` estable (catálogo de errores, spec 001 §5).
 * `cause` es opcional y se expone en el cuerpo (`RECOVERY_NOT_ALLOWED`, `ROBOT_START_NOT_VERIFIABLE`).
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly cause?: RecoveryRejectionCause,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const zoneNotFound = (id: number) =>
  new AppError(404, 'ZONE_NOT_FOUND', `Zone ${id} not found`);

export const zoneNameDuplicate = (name: string) =>
  new AppError(409, 'ZONE_NAME_DUPLICATE', `Zone name "${name}" already exists`);

export const invalidZoneDimensions = () =>
  new AppError(422, 'INVALID_ZONE_DIMENSIONS', 'Zone width and height must be greater than 0');

export const zoneOutOfBounds = () =>
  new AppError(422, 'ZONE_OUT_OF_BOUNDS', 'Zone must be fully inside the floor plan');

export const validationError = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);

// Spec 003 — destino fuera del plano (lo emite el servicio; DD-107)
export const destinationOutOfBounds = () =>
  new AppError(422, 'DESTINATION_OUT_OF_BOUNDS', 'Destination outside floor');

// Spec 002 — payload inválido de POST /api/robots/:robotId/position (design §7, mapeo decisión → HTTP)
export const invalidPosition = (message: string) => new AppError(422, 'INVALID_POSITION', message);

// Spec 003 RF-07 — catálogo de robots
export const invalidRobot = (message: string) => new AppError(422, 'INVALID_ROBOT', message);

export const robotNameDuplicate = (name: string) =>
  new AppError(409, 'ROBOT_NAME_DUPLICATE', `Robot name "${name}" already exists`);

// Spec 002 R11.2 — cuerpo de POST /api/robots/:robotId/move inválido (MoveCommand)
export const invalidMoveRequest = (message: string) =>
  new AppError(422, 'INVALID_MOVE_REQUEST', message);

// Spec 002 — lectura RELIABLE fuera del plano (R8.5)
export const positionOutOfBounds = () =>
  new AppError(422, 'POSITION_OUT_OF_BOUNDS', 'Position outside floor');

// Spec 002/003 — robot inexistente (design §4, paso 1 del delta del servicio)
export const robotNotFound = (id: number) =>
  new AppError(404, 'ROBOT_NOT_FOUND', `Robot ${id} not found`);

// Spec 002 — incidente inexistente (R5.7)
export const incidentNotFound = (id: number) =>
  new AppError(404, 'INCIDENT_NOT_FOUND', `Incident ${id} not found`);
