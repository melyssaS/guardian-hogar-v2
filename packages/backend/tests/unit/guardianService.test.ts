import type { Point } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createTestDb, createTestGuardian, type TestGuardian } from '../helpers.js';

// Robot sembrado: IDLE en (120, 90) (Sala), positionQuality RELIABLE (migraciones 002/005).
// Zonas activas del seed: Escaleras (29,226,160,178) y Cuarto del bebé (206,226,187,178).

/** Construye el servicio sobre repos reales en memoria. `getActiveZones` puede lanzar (caso G). */
function build(db: Db, getActiveZones?: () => never): TestGuardian {
  const zones = createZoneRepository(db);
  return createTestGuardian(db, {
    robots: createRobotRepository(db),
    incidents: createIncidentRepository(db),
    audit: createAuditLogRepository(db),
    transitions: createTransitionLogRepository(db),
    getActiveZones: getActiveZones ?? (() => zones.findAll('active')),
    runInTransaction: (fn) => db.transaction(fn)(),
    pad: 0,
  });
}

/** Filas crudas de `audit_log` en orden de inserción. */
function readAuditLog(db: Db): Array<Record<string, unknown>> {
  return db.prepare('SELECT event_code, state, x, y FROM audit_log ORDER BY id').all() as Array<
    Record<string, unknown>
  >;
}

const FREE: Point = { x: 450, y: 120 }; // Pasillo/Cocina: libre con pad=0.
const IN_STAIRS: Point = { x: 100, y: 300 }; // Dentro de Escaleras.

describe('guardianService', () => {
  let db: Db;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    service = build(db);
  });

  it('getState devuelve el snapshot sembrado (IDLE, RELIABLE)', () => {
    expect(service.getState(1)).toEqual({
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'RELIABLE',
    });
  });

  it('R1.5 AUTHORIZED: actualiza la posición y deja el robot en IDLE (vivacidad)', () => {
    const out = service.move(1, FREE);
    expect(out).toMatchObject({ decision: 'AUTHORIZED', state: 'IDLE', position: FREE });
    expect(service.getState(1)).toEqual({
      state: 'IDLE',
      position: FREE,
      positionQuality: 'RELIABLE',
    });
    // Property 9: un segundo movimiento válido también se autoriza (no queda en BUSY).
    expect(service.move(1, { x: 500, y: 150 }).decision).toBe('AUTHORIZED');
  });

  it('R5.2 denegación geométrica: SAFE_STOP + exactamente UN incidente con snapshot de zonas', () => {
    const out = service.move(1, IN_STAIRS);
    expect(out).toMatchObject({
      decision: 'DENIED',
      code: 'RESTRICTED_ZONE_VIOLATION',
      state: 'SAFE_STOP',
      collisionType: 'RESTRICTED_ZONE_VIOLATION',
      position: { x: 120, y: 90 }, // R3.3: no cambia la posición.
    });
    if (out.decision !== 'DENIED') throw new Error('se esperaba DENIED');
    expect(out.incidentId).toBeGreaterThan(0);

    const incidents = createIncidentRepository(db).findAll();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      decisionCode: 'RESTRICTED_ZONE_VIOLATION',
      stateAfter: 'SAFE_STOP',
    });
    const detail = createIncidentRepository(db).findById(out.incidentId);
    expect(detail?.zonesSnapshot.length).toBe(2); // Escaleras + Cuarto del bebé.
    expect(service.getState(1).state).toBe('SAFE_STOP');
  });

  it('R5.3 rechazo por estado en SAFE_STOP: NO crea incidente, SÍ registra en audit_log', () => {
    service.move(1, IN_STAIRS); // → SAFE_STOP, 1 incidente.
    const out = service.move(1, FREE); // rechazo por estado.
    expect(out).toMatchObject({
      decision: 'REJECTED',
      code: 'SAFE_STOP_ACTIVE',
      state: 'SAFE_STOP',
    });
    // No se crea un segundo incidente (Property 6).
    expect(createIncidentRepository(db).findAll()).toHaveLength(1);
    // El rechazo queda auditado.
    expect(readAuditLog(db)).toEqual([
      expect.objectContaining({
        event_code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        x: FREE.x,
        y: FREE.y,
      }),
    ]);
  });

  it('R3.1 denegación por datos (UNRELIABLE): DEGRADED + incidente', () => {
    createRobotRepository(db).saveFull({
      state: 'IDLE',
      position: { x: 120, y: 90 },
      positionQuality: 'UNRELIABLE',
    });
    const out = service.move(1, FREE);
    expect(out).toMatchObject({
      decision: 'DENIED',
      code: 'INSUFFICIENT_DATA',
      state: 'DEGRADED',
      collisionType: null,
    });
    expect(createIncidentRepository(db).findAll()).toHaveLength(1);
    expect(service.getState(1).state).toBe('DEGRADED');
  });

  it('R2.4 repositorio de zonas caído: ZONE_DATA_UNAVAILABLE → SAFE_STOP + incidente', () => {
    const failing = build(db, () => {
      throw new Error('zone repo down');
    });
    const out = failing.move(1, FREE);
    expect(out).toMatchObject({
      decision: 'DENIED',
      code: 'ZONE_DATA_UNAVAILABLE',
      state: 'SAFE_STOP',
    });
    const incidents = createIncidentRepository(db).findAll();
    expect(incidents).toHaveLength(1);
    // zones = null → snapshot vacío (el detalle lo trae; el resumen no).
    expect(createIncidentRepository(db).findById(incidents[0]?.id ?? 0)?.zonesSnapshot).toEqual([]);
  });

  describe('recover (R4)', () => {
    it('R4.1 válido: desde SAFE_STOP con posición segura y RELIABLE → IDLE', () => {
      service.move(1, IN_STAIRS); // → SAFE_STOP; posición (120,90) es segura (Sala, inactiva).
      const out = service.recover(1);
      expect(out).toMatchObject({
        kind: 'ok',
        value: { state: 'IDLE', position: { x: 120, y: 90 }, transitioned: true },
      });
      expect(service.getState(1).state).toBe('IDLE');
      // Tras recuperar, un movimiento válido vuelve a autorizarse.
      expect(service.move(1, FREE).decision).toBe('AUTHORIZED');
    });

    it('R4.2 inválido por datos no confiables: permanece en parada sin cambios', () => {
      service.move(1, IN_STAIRS); // → SAFE_STOP.
      createRobotRepository(db).setPositionQuality('UNRELIABLE');
      const out = service.recover(1);
      expect(out).toMatchObject({ kind: 'rejected', code: 'RECOVERY_NOT_ALLOWED' });
      expect(service.getState(1).state).toBe('SAFE_STOP');
    });

    it('R4.2 inválido por posición insegura: permanece en parada sin cambios', () => {
      // Robot dentro de Escaleras y en SAFE_STOP: la recuperación debe rechazarse.
      createRobotRepository(db).saveFull({
        state: 'SAFE_STOP',
        position: IN_STAIRS,
        positionQuality: 'RELIABLE',
      });
      const out = service.recover(1);
      expect(out).toMatchObject({ kind: 'rejected', code: 'RECOVERY_NOT_ALLOWED' });
      expect(service.getState(1).state).toBe('SAFE_STOP');
    });

    it('R4.5 fuera de parada (IDLE): idempotente, transitioned false y sin efectos', () => {
      const out = service.recover(1);
      expect(out).toMatchObject({ kind: 'ok', value: { transitioned: false } });
      expect(service.getState(1).state).toBe('IDLE');
    });
  });

  it('R8.5 setPosition RELIABLE coincidente: fija solo la calidad, sin relocalizar ni cambiar el estado', () => {
    // Primero una calidad perdida (sin pasar por la señal de pérdida, que llevaría a DEGRADED).
    createRobotRepository(db).setPositionQuality('MISSING');
    const out = service.setPosition(1, { position: { x: 120, y: 90 }, quality: 'RELIABLE' });
    expect(out).toEqual({
      kind: 'ok',
      value: { state: 'IDLE', position: { x: 120, y: 90 }, positionQuality: 'RELIABLE' },
    });
    // Property 10: con RELIABLE ya se evalúa geometría y un destino libre se autoriza.
    expect(service.move(1, FREE).decision).toBe('AUTHORIZED');
  });
});
