import { FLOOR_HEIGHT, FLOOR_WIDTH } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/AppError.js';
import {
  assertDestinationWithinFloor,
  assertPositionWithinFloor,
} from '../../src/services/floorBounds.js';

// CA-03.5: el borde del plano es inclusivo; solo lo estrictamente fuera se rechaza.
const VALID_EDGES = [
  { x: 0, y: 0 },
  { x: FLOOR_WIDTH, y: 0 },
  { x: 0, y: FLOOR_HEIGHT },
  { x: FLOOR_WIDTH, y: FLOOR_HEIGHT },
];
const OUTSIDE = [
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: FLOOR_WIDTH + 1, y: 0 },
  { x: 0, y: FLOOR_HEIGHT + 1 },
  { x: FLOOR_WIDTH + 1, y: FLOOR_HEIGHT + 1 },
];

describe('assertDestinationWithinFloor (CA-03.5)', () => {
  it.each(VALID_EDGES)('acepta el borde válido (%o)', (p) => {
    expect(() => assertDestinationWithinFloor(p)).not.toThrow();
  });

  it.each(OUTSIDE)('rechaza el punto fuera del plano (%o) con DESTINATION_OUT_OF_BOUNDS', (p) => {
    expect(() => assertDestinationWithinFloor(p)).toThrow(AppError);
    expect(() => assertDestinationWithinFloor(p)).toThrow(
      expect.objectContaining({ code: 'DESTINATION_OUT_OF_BOUNDS' }),
    );
  });
});

describe('assertPositionWithinFloor (R8.5)', () => {
  it.each(VALID_EDGES)('acepta el borde válido (%o)', (p) => {
    expect(() => assertPositionWithinFloor(p)).not.toThrow();
  });

  it.each(OUTSIDE)('rechaza el punto fuera del plano (%o) con POSITION_OUT_OF_BOUNDS', (p) => {
    expect(() => assertPositionWithinFloor(p)).toThrow(
      expect.objectContaining({ code: 'POSITION_OUT_OF_BOUNDS' }),
    );
  });
});
