/** Error de dominio con status HTTP y `code` estable (catálogo de errores, spec 001 §5). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
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
