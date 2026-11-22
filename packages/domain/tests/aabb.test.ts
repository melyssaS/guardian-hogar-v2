import { describe, expect, it } from 'vitest';
import { expandZone, pointInAABB } from '../src/geometry/aabb.js';

// Z1 de la spec 001 (§7)
const Z1 = { x: 100, y: 100, width: 200, height: 150 };

describe('expandZone (DD-001)', () => {
  it('expande r+m por lado', () => {
    expect(expandZone(Z1, 30)).toEqual({ minX: 70, minY: 70, maxX: 330, maxY: 280 });
  });

  it('con pad 0 devuelve la zona base', () => {
    expect(expandZone(Z1, 0)).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 250 });
  });
});

describe('pointInAABB (DD-003, borde inclusivo)', () => {
  const box = expandZone(Z1, 30);

  it('punto interior está dentro', () => {
    expect(pointInAABB({ x: 200, y: 175 }, box)).toBe(true);
  });

  it.each([
    [70, 175],
    [330, 175],
    [200, 70],
    [200, 280],
    [70, 70],
    [330, 280],
  ])('punto sobre el borde (%d,%d) está dentro', (x, y) => {
    expect(pointInAABB({ x, y }, box)).toBe(true);
  });

  it.each([
    [69.999, 175],
    [330.001, 175],
    [200, 69.999],
    [200, 280.001],
  ])('punto justo fuera (%d,%d) está fuera', (x, y) => {
    expect(pointInAABB({ x, y }, box)).toBe(false);
  });
});
