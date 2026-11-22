import { describe, expect, it } from 'vitest';
import { isCollision } from '../src/geometry/collision.js';
import { expandZone, pointInAABB } from '../src/geometry/aabb.js';
import type { CollisionType, Point } from '../src/index.js';

// Spec 001 §7: Z1 = (100,100,200,150), r = 20, m = 10 fijados explícitamente → pad = 30.
const Z1 = { x: 100, y: 100, width: 200, height: 150 };
const R = 20;
const M = 10;
const PAD = R + M;

const seg = (fx: number, fy: number, tx: number, ty: number) => ({
  from: { x: fx, y: fy },
  to: { x: tx, y: ty },
});

describe('isCollision — escenarios de borde B1–B9 (pad = 30)', () => {
  const cases: Array<[string, ReturnType<typeof seg>, boolean, CollisionType | null]> = [
    ['B1 destino claramente dentro', seg(0, 0, 200, 175), true, 'RESTRICTED_ZONE_VIOLATION'],
    ['B2 destino fuera, no cruza', seg(0, 0, 50, 50), false, null],
    ['B3 trayectoria atraviesa Z1', seg(0, 175, 400, 175), true, 'TRAJECTORY_CROSSES_ZONE'],
    ['B4 origen ya dentro', seg(200, 175, 0, 0), true, 'ORIGIN_IN_RESTRICTED_ZONE'],
    ['B5 destino sobre el borde base', seg(0, 0, 100, 175), true, 'RESTRICTED_ZONE_VIOLATION'],
    ['B6 destino en la banda de expansión', seg(0, 0, 85, 175), true, 'RESTRICTED_ZONE_VIOLATION'],
    ['B7 destino fuera de la caja expandida', seg(0, 0, 69, 175), false, null],
    [
      'B8 tangente a la esquina (330,280)',
      seg(400, 210, 260, 350),
      true,
      'TRAJECTORY_CROSSES_ZONE',
    ],
    ['B9 degenerado fuera de Z1', seg(50, 50, 50, 50), false, null],
  ];

  it.each(cases)('%s', (_name, s, collides, type) => {
    expect(isCollision(Z1, s, PAD)).toEqual({ collides, type });
  });
});

describe('isCollision — propiedades del diseño', () => {
  it('pad 0: B6 deja de colisionar (sin expansión)', () => {
    expect(isCollision(Z1, seg(0, 0, 85, 175), 0)).toEqual({ collides: false, type: null });
  });

  it('pad por defecto es COLLISION_PAD = 0 sin variables de entorno', () => {
    expect(isCollision(Z1, seg(0, 0, 85, 175)).collides).toBe(false);
    expect(isCollision(Z1, seg(0, 0, 100, 175)).collides).toBe(true);
  });

  it('Property 4: collides es simétrico respecto al sentido del segmento', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 200, y: 175 },
      { x: 400, y: 175 },
      { x: 0, y: 175 },
      { x: 69, y: 175 },
      { x: 400, y: 210 },
      { x: 260, y: 350 },
      { x: 500, y: 500 },
    ];
    for (const a of points) {
      for (const b of points) {
        expect(isCollision(Z1, { from: a, to: b }, PAD).collides).toBe(
          isCollision(Z1, { from: b, to: a }, PAD).collides,
        );
      }
    }
  });

  it('Property 5: segmento degenerado equivale a pointInAABB', () => {
    const box = expandZone(Z1, PAD);
    for (const p of [
      { x: 50, y: 50 },
      { x: 70, y: 70 },
      { x: 200, y: 175 },
      { x: 331, y: 280 },
    ]) {
      expect(isCollision(Z1, { from: p, to: p }, PAD).collides).toBe(pointInAABB(p, box));
    }
  });
});
