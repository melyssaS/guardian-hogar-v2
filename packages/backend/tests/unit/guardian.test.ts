import type { GuardianInput, Zone } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { evaluateMovement } from '../../src/rules/guardian.js';

// Spec 002 — tarea 4 (TDD). Conjunto enfocado que prueba la regla pura y el ORDEN estricto:
// estado → UNRELIABLE → MISSING → repo caído → origen → destino → trayectoria → AUTHORIZED.
// La suite T-12 completa (28 escenarios) corresponde a las tareas 16-20.
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
const ORIGIN = { x: 120, y: 90 }; // Sala, fuera de toda zona

const input = (over: Partial<GuardianInput>): GuardianInput => ({
  state: 'IDLE',
  positionQuality: 'RELIABLE',
  origin: ORIGIN,
  destination: { x: 450, y: 120 },
  zones: ZONES,
  pad: 0,
  ...over,
});

describe('evaluateMovement — vigilante de seguridad (spec 002)', () => {
  describe('Paso 1: estado no admite movimiento (R2.1)', () => {
    it.each(['SAFE_STOP', 'DEGRADED', 'RECOVERING'] as const)(
      'estado %s → SAFE_STOP_ACTIVE (rechazo, nextState = estado actual, sin incidente)',
      (state) => {
        expect(evaluateMovement(input({ state }))).toEqual({
          code: 'SAFE_STOP_ACTIVE',
          authorized: false,
          nextState: state,
          collisionType: null,
          reason: expect.any(String),
        });
      },
    );

    it('estado MOVING ocupado → BUSY (nextState MOVING)', () => {
      const r = evaluateMovement(input({ state: 'MOVING' }));
      expect(r.code).toBe('BUSY');
      expect(r.authorized).toBe(false);
      expect(r.nextState).toBe('MOVING');
      expect(r.collisionType).toBeNull();
    });

    it('el estado se evalúa ANTES que los datos: SAFE_STOP + UNRELIABLE → SAFE_STOP_ACTIVE', () => {
      expect(
        evaluateMovement(input({ state: 'SAFE_STOP', positionQuality: 'UNRELIABLE' })).code,
      ).toBe('SAFE_STOP_ACTIVE');
    });
  });

  describe('Paso 2-3: calidad de datos antes que geometría (R2.2, R2.3)', () => {
    it('UNRELIABLE → INSUFFICIENT_DATA, nextState DEGRADED, sin geometría', () => {
      expect(evaluateMovement(input({ positionQuality: 'UNRELIABLE' }))).toEqual({
        code: 'INSUFFICIENT_DATA',
        authorized: false,
        nextState: 'DEGRADED',
        collisionType: null,
        reason: expect.any(String),
      });
    });

    it('MISSING → MISSING_POSITION, nextState DEGRADED, sin geometría', () => {
      expect(evaluateMovement(input({ positionQuality: 'MISSING' }))).toEqual({
        code: 'MISSING_POSITION',
        authorized: false,
        nextState: 'DEGRADED',
        collisionType: null,
        reason: expect.any(String),
      });
    });

    it('UNRELIABLE se evalúa antes que MISSING (orden estricto)', () => {
      // Si ambas banderas "de datos" fueran posibles, UNRELIABLE gana por orden; aquí basta
      // comprobar que UNRELIABLE no se confunde con MISSING ni con geometría.
      expect(evaluateMovement(input({ positionQuality: 'UNRELIABLE', zones: null })).code).toBe(
        'INSUFFICIENT_DATA',
      );
    });
  });

  describe('Paso 4: repositorio de zonas caído (R2.4)', () => {
    it('zones === null → ZONE_DATA_UNAVAILABLE, nextState SAFE_STOP, sin geometría', () => {
      expect(evaluateMovement(input({ zones: null }))).toEqual({
        code: 'ZONE_DATA_UNAVAILABLE',
        authorized: false,
        nextState: 'SAFE_STOP',
        collisionType: null,
        reason: expect.any(String),
      });
    });

    it('los datos se evalúan antes que el repo caído: MISSING + zones null → MISSING_POSITION', () => {
      expect(evaluateMovement(input({ positionQuality: 'MISSING', zones: null })).code).toBe(
        'MISSING_POSITION',
      );
    });
  });

  describe('Paso 5-7: geometría reutilizando isCollision (R1.1, R1.2, R1.3, R1.4, R1.6)', () => {
    it('origen dentro de una zona → ORIGIN_IN_RESTRICTED_ZONE, SAFE_STOP', () => {
      const r = evaluateMovement(
        input({ origin: { x: 300, y: 300 }, destination: { x: 450, y: 120 } }),
      );
      expect(r).toEqual({
        code: 'ORIGIN_IN_RESTRICTED_ZONE',
        authorized: false,
        nextState: 'SAFE_STOP',
        collisionType: 'ORIGIN_IN_RESTRICTED_ZONE',
        zoneName: 'Cuarto del bebé',
        reason: expect.any(String),
      });
    });

    it('destino dentro de una zona → RESTRICTED_ZONE_VIOLATION, SAFE_STOP', () => {
      const r = evaluateMovement(input({ destination: { x: 100, y: 300 } }));
      expect(r).toEqual({
        code: 'RESTRICTED_ZONE_VIOLATION',
        authorized: false,
        nextState: 'SAFE_STOP',
        collisionType: 'RESTRICTED_ZONE_VIOLATION',
        zoneName: 'Escaleras',
        reason: expect.any(String),
      });
    });

    it('trayectoria cruza una zona (origen y destino libres) → TRAJECTORY_CROSSES_ZONE', () => {
      const r = evaluateMovement(input({ destination: { x: 110, y: 600 } }));
      expect(r).toEqual({
        code: 'TRAJECTORY_CROSSES_ZONE',
        authorized: false,
        nextState: 'SAFE_STOP',
        collisionType: 'TRAJECTORY_CROSSES_ZONE',
        zoneName: 'Escaleras',
        reason: expect.any(String),
      });
    });
  });

  describe('Prioridad global entre varias zonas (R1.7, R2.5)', () => {
    it('ORIGIN en una zona supera DESTINO en otra', () => {
      // Origen dentro de Cuarto del bebé; destino dentro de Escaleras.
      const r = evaluateMovement(
        input({ origin: { x: 300, y: 300 }, destination: { x: 100, y: 300 } }),
      );
      expect(r.code).toBe('ORIGIN_IN_RESTRICTED_ZONE');
    });

    it('DESTINO en una zona supera TRAYECTORIA que cruza otra', () => {
      // Origen libre (Sala). Destino dentro de Escaleras; de paso la trayectoria roza/cruza.
      // Destino dentro de la zona debe ganar a cualquier cruce de trayectoria en otra zona.
      const r = evaluateMovement(
        input({ origin: { x: 120, y: 90 }, destination: { x: 100, y: 300 } }),
      );
      expect(r.code).toBe('RESTRICTED_ZONE_VIOLATION');
    });

    it('el orden de las zonas en el array no altera la prioridad global', () => {
      const base = input({ origin: { x: 300, y: 300 }, destination: { x: 100, y: 300 } });
      const reversed = { ...base, zones: [...ZONES].reverse() };
      expect(evaluateMovement(base).code).toBe(evaluateMovement(reversed).code);
      expect(evaluateMovement(base).code).toBe('ORIGIN_IN_RESTRICTED_ZONE');
    });
  });

  describe('Paso 8: AUTHORIZED (R1.5)', () => {
    it('destino y trayectoria libres → AUTHORIZED, authorized true, nextState MOVING', () => {
      expect(evaluateMovement(input({ destination: { x: 450, y: 120 } }))).toEqual({
        code: 'AUTHORIZED',
        authorized: true,
        nextState: 'MOVING',
        collisionType: null,
        reason: expect.any(String),
      });
    });

    it('sin zonas activas (lista vacía) → AUTHORIZED', () => {
      expect(evaluateMovement(input({ zones: [], destination: { x: 100, y: 300 } })).code).toBe(
        'AUTHORIZED',
      );
    });

    it('ignora zonas inactivas al evaluar geometría', () => {
      const inactiveStairs: Zone = { ...STAIRS, active: false };
      // Destino dentro de Escaleras, pero Escaleras está inactiva → AUTHORIZED.
      const r = evaluateMovement(
        input({ zones: [inactiveStairs], destination: { x: 100, y: 300 } }),
      );
      expect(r.code).toBe('AUTHORIZED');
    });
  });

  describe('Pureza y determinismo (R7.3, Property 8)', () => {
    it('mismas entradas → misma salida', () => {
      const i = input({ destination: { x: 100, y: 300 } });
      expect(evaluateMovement(i)).toEqual(evaluateMovement(i));
    });

    it('no muta sus entradas', () => {
      const i = input({ destination: { x: 100, y: 300 } });
      const snapshot = structuredClone(i);
      evaluateMovement(i);
      expect(i).toEqual(snapshot);
    });
  });
});
