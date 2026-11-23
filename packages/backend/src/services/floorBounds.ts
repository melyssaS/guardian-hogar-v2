import { FLOOR_HEIGHT, FLOOR_WIDTH, type Point } from '@home-guardian/domain';
import { destinationOutOfBounds, positionOutOfBounds } from '../errors/AppError.js';

/** Borde inclusivo: x=0, x=FLOOR_WIDTH, y=0 e y=FLOOR_HEIGHT son válidos (comparaciones estrictas). */
function isWithinFloor(p: Point): boolean {
  return !(p.x < 0 || p.y < 0 || p.x > FLOOR_WIDTH || p.y > FLOOR_HEIGHT);
}

/**
 * RF-01.4 / RF-01.5 — CA-03.5. Fuera del plano → 422 DESTINATION_OUT_OF_BOUNDS.
 */
export function assertDestinationWithinFloor(p: Point): void {
  if (!isWithinFloor(p)) throw destinationOutOfBounds();
}

/** Spec 002 R8.5: una lectura RELIABLE fuera del plano → 422 POSITION_OUT_OF_BOUNDS. */
export function assertPositionWithinFloor(p: Point): void {
  if (!isWithinFloor(p)) throw positionOutOfBounds();
}
