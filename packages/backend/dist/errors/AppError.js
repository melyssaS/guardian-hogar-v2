/** Error de dominio con status HTTP y `code` estable (catálogo de errores, spec 001 §5). */
export class AppError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = 'AppError';
    }
}
export const zoneNotFound = (id) => new AppError(404, 'ZONE_NOT_FOUND', `Zone ${id} not found`);
export const zoneNameDuplicate = (name) => new AppError(409, 'ZONE_NAME_DUPLICATE', `Zone name "${name}" already exists`);
export const invalidZoneDimensions = () => new AppError(422, 'INVALID_ZONE_DIMENSIONS', 'Zone width and height must be greater than 0');
export const zoneOutOfBounds = () => new AppError(422, 'ZONE_OUT_OF_BOUNDS', 'Zone must be fully inside the floor plan');
export const validationError = (message) => new AppError(422, 'VALIDATION_ERROR', message);
