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
// Spec 003 — catálogo de errores de /api/simulation
export const destinationOutOfBounds = () => new AppError(422, 'DESTINATION_OUT_OF_BOUNDS', 'Destination outside floor');
export const invalidDestination = (message) => new AppError(422, 'INVALID_DESTINATION', message);
// Spec 002 — payload inválido de /api/robot/position (design §7, mapeo decisión → HTTP)
export const invalidPosition = (message) => new AppError(422, 'INVALID_POSITION', message);
// Spec 002/003 — robot inexistente (design §4, paso 1 del delta del servicio)
export const robotNotFound = (id) => new AppError(404, 'ROBOT_NOT_FOUND', `Robot ${id} not found`);
