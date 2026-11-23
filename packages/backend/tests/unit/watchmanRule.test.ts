import type { Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { decideMovement, type DecideMovementInput } from '../../src/rules/watchmanRule.js';

// Spec 003 — tareas 7 y 19 (TDD). Zonas restringidas del prototipo, pad 0 explícito.
const zone = (id: number, name: string, x: number, y: number, w: number, h: number): Zone => ({
  id,
  name,
  x,
  y,
  width: w,
  height: h,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
});
const STAIRS = zone(3, 'Escaleras', 29, 226, 160, 178);
const NURSERY = zone(4, 'Cuarto del bebé', 206, 226, 187, 178);
const ZONES = [STAIRS, NURSERY];
const ORIGIN = { x: 120, y: 90 }; // Sala

const input = (over: Partial<DecideMovementInput>): DecideMovementInput => ({
  state: 'IDLE',
  origin: ORIGIN,
  destination: { x: 250, y: 120 },
  activeZones: ZONES,
  pad: 0,
  ...over,
});

describe('decideMovement — vigilante (spec 003)', () => {
  describe('CA-03.1 ALLOW con destino y trayectoria libres', () => {
    it('mueve el robot al destino y devuelve MOVING', () => {
      expect(decideMovement(input({ destination: { x: 450, y: 120 } }))).toEqual({
        decision: 'ALLOW',
        state: 'MOVING',
        position: { x: 450, y: 120 },
        reason: 'Destination and trajectory are clear',
      });
    });

    it('sin zonas activas siempre permite', () => {
      const r = decideMovement(input({ destination: { x: 100, y: 300 }, activeZones: [] }));
      expect(r.decision).toBe('ALLOW');
    });
  });

  describe('CA-03.2 PREVENTIVE_STOP con destino dentro de una zona', () => {
    it('no se mueve, pasa a SAFE_STOP e indica causa y zona', () => {
      expect(decideMovement(input({ destination: { x: 100, y: 300 } }))).toEqual({
        decision: 'PREVENTIVE_STOP',
        state: 'SAFE_STOP',
        position: ORIGIN,
        collisionType: 'RESTRICTED_ZONE_VIOLATION',
        zoneName: 'Escaleras',
        reason: 'Destination is inside restricted zone: Escaleras',
      });
    });

    it('el borde de la zona pertenece a la zona (DD-003)', () => {
      const r = decideMovement(input({ destination: { x: 29, y: 226 } }));
      expect(r.decision).toBe('PREVENTIVE_STOP');
    });

    it('aplica el pad r+m: un punto fuera de la zona colisiona si cae en la expansión', () => {
      // Pasillo vertical x=195 entre Escaleras (x máx 189) y Cuarto del bebé (x mín 206).
      const move = {
        origin: { x: 195, y: 90 },
        destination: { x: 195, y: 300 },
      };
      expect(decideMovement(input({ ...move, pad: 0 })).decision).toBe('ALLOW');
      expect(decideMovement(input({ ...move, pad: 10 })).decision).toBe('PREVENTIVE_STOP');
    });
  });

  describe('CA-03.3 PREVENTIVE_STOP cuando la trayectoria cruza una zona', () => {
    it('destino libre al otro lado de la zona → TRAJECTORY_CROSSES_ZONE', () => {
      // De la Sala a debajo de las Escaleras (y > 404): el segmento atraviesa la zona.
      expect(decideMovement(input({ destination: { x: 110, y: 600 } }))).toEqual({
        decision: 'PREVENTIVE_STOP',
        state: 'SAFE_STOP',
        position: ORIGIN,
        collisionType: 'TRAJECTORY_CROSSES_ZONE',
        zoneName: 'Escaleras',
        reason: 'Trajectory crosses restricted zone: Escaleras',
      });
    });
  });

  it('origen dentro de una zona activa → PREVENTIVE_STOP con ORIGIN_IN_RESTRICTED_ZONE', () => {
    const r = decideMovement(
      input({ origin: { x: 300, y: 300 }, destination: { x: 450, y: 120 } }),
    );
    expect(r).toMatchObject({
      decision: 'PREVENTIVE_STOP',
      state: 'SAFE_STOP',
      position: { x: 300, y: 300 },
      collisionType: 'ORIGIN_IN_RESTRICTED_ZONE',
      zoneName: 'Cuarto del bebé',
      reason: 'Origin is inside restricted zone: Cuarto del bebé',
    });
  });

  it('con varias zonas en colisión informa la primera encontrada', () => {
    // De (10,210) a (500,300): el segmento cruza Escaleras y Cuarto del bebé.
    const r = decideMovement(input({ origin: { x: 10, y: 210 }, destination: { x: 500, y: 300 } }));
    expect(r.zoneName).toBe('Escaleras');
  });

  describe('CA-03.4 DENIED_SAFE_STOP desde SAFE_STOP', () => {
    it.each([
      ['destino libre', { x: 450, y: 120 }],
      ['destino en zona', { x: 100, y: 300 }],
    ])('rechaza (%s) sin cambiar estado ni posición', (_label, destination) => {
      expect(decideMovement(input({ state: 'SAFE_STOP', destination }))).toEqual({
        decision: 'DENIED_SAFE_STOP',
        code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        position: ORIGIN,
        reason: 'Robot is in SAFE_STOP; movement denied',
      });
    });
  });

  describe('RNF-06 determinismo y pureza', () => {
    it('mismas entradas → misma salida', () => {
      for (const destination of [
        { x: 450, y: 120 },
        { x: 100, y: 300 },
        { x: 110, y: 600 },
      ]) {
        const a = decideMovement(input({ destination }));
        const b = decideMovement(input({ destination }));
        expect(a).toEqual(b);
      }
    });

    it('no muta sus entradas', () => {
      const i = input({ destination: { x: 100, y: 300 } });
      const snapshot = structuredClone(i);
      decideMovement(i);
      expect(i).toEqual(snapshot);
    });

    it('la posición devuelta es una copia, no la referencia de entrada', () => {
      const i = input({ destination: { x: 100, y: 300 } });
      expect(decideMovement(i).position).not.toBe(i.origin);
    });
  });
});
