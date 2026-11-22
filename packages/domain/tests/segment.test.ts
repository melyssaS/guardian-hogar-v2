import { describe, expect, it } from 'vitest';
import { segmentIntersectsAABB } from '../src/geometry/collision.js';
import type { AABB } from '../src/geometry/types.js';

// Caja expandida de Z1 con pad 30
const box: AABB = { minX: 70, minY: 70, maxX: 330, maxY: 280 };

describe('segmentIntersectsAABB (Liang-Barsky, DD-002)', () => {
  it('segmento que atraviesa la caja interseca (B3)', () => {
    expect(segmentIntersectsAABB({ from: { x: 0, y: 175 }, to: { x: 400, y: 175 } }, box)).toBe(
      true,
    );
  });

  it('segmento completamente fuera no interseca (B2)', () => {
    expect(segmentIntersectsAABB({ from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }, box)).toBe(false);
  });

  it('segmento que termina antes de la caja no interseca (B7)', () => {
    expect(segmentIntersectsAABB({ from: { x: 0, y: 0 }, to: { x: 69, y: 175 } }, box)).toBe(false);
  });

  it('segmento tangente a la esquina interseca (B8, borde inclusivo)', () => {
    expect(segmentIntersectsAABB({ from: { x: 400, y: 210 }, to: { x: 260, y: 350 } }, box)).toBe(
      true,
    );
  });

  it('segmento que recorre un borde interseca', () => {
    expect(segmentIntersectsAABB({ from: { x: 0, y: 70 }, to: { x: 500, y: 70 } }, box)).toBe(true);
  });

  it('segmento paralelo y fuera no interseca', () => {
    expect(segmentIntersectsAABB({ from: { x: 0, y: 69 }, to: { x: 500, y: 69 } }, box)).toBe(
      false,
    );
  });

  it('segmento con extremo dentro interseca', () => {
    expect(segmentIntersectsAABB({ from: { x: 0, y: 0 }, to: { x: 200, y: 175 } }, box)).toBe(true);
  });

  describe('segmento degenerado origen == destino (B4, B9)', () => {
    it('fuera de la caja no interseca y no lanza (B9)', () => {
      expect(() =>
        segmentIntersectsAABB({ from: { x: 50, y: 50 }, to: { x: 50, y: 50 } }, box),
      ).not.toThrow();
      expect(segmentIntersectsAABB({ from: { x: 50, y: 50 }, to: { x: 50, y: 50 } }, box)).toBe(
        false,
      );
    });

    it('dentro de la caja interseca', () => {
      expect(segmentIntersectsAABB({ from: { x: 200, y: 175 }, to: { x: 200, y: 175 } }, box)).toBe(
        true,
      );
    });

    it('sobre el borde interseca', () => {
      expect(segmentIntersectsAABB({ from: { x: 70, y: 70 }, to: { x: 70, y: 70 } }, box)).toBe(
        true,
      );
    });
  });
});
