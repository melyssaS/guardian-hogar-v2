import type { Point } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/db/bootstrap.js';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import {
  createTestDb,
  createTestGuardian,
  getRobotState,
  setRobotState,
  type TestGuardian,
} from '../helpers.js';

/**
 * VERIFICAR (MADA): verificación de trazabilidad del `guardianService` y del reinicio seguro
 * `bootstrap`. Cada caso mapea explícitamente a un requisito (R4.1, R4.2, R5.2, R5.3, R6.1,
 * R6.2) con al menos una aserción, complementando `guardianService.test.ts` y
 * `bootstrap.test.ts` sin editarlos. El objetivo es la cobertura completa de los criterios de
 * aceptación listados, no duplicar aserciones idénticas.
 *
 * Robot sembrado (migraciones 002/005): IDLE en (120, 90) (Sala, zona inactiva), RELIABLE.
 * Zonas activas del seed: Escaleras (29,226,160,178) y Cuarto del bebé (206,226,187,178).
 */

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

/** Filas crudas de `audit_log` en orden de inserción (R5.3). */
function readAuditLog(db: Db): Array<Record<string, unknown>> {
  return db.prepare('SELECT event_code, state, x, y FROM audit_log ORDER BY id').all() as Array<
    Record<string, unknown>
  >;
}

const FREE: Point = { x: 450, y: 120 }; // Pasillo/Cocina: libre con pad=0.
const FREE_2: Point = { x: 500, y: 150 }; // Otro destino libre.
const IN_STAIRS: Point = { x: 100, y: 300 }; // Dentro de Escaleras (zona activa).
const IN_BABY_ROOM: Point = { x: 300, y: 300 }; // Dentro de Cuarto del bebé (zona activa).

describe('VERIFICAR · guardianService (trazabilidad de requisitos)', () => {
  let db: Db;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    service = build(db);
  });

  describe('R5.1 · registro siempre de la evaluación', () => {
    it('R5.1: un AUTHORIZED queda registrado por el cambio de estado/posición persistido', () => {
      // El servicio documenta (JSDoc §registro de evaluaciones) que un AUTHORIZED se registra
      // por el propio snapshot persistido, no en incidents ni audit_log.
      const before = service.getStatus(1);
      expect(before.position).toEqual({ x: 120, y: 90 });

      const out = service.move(1, FREE);
      expect(out.decision).toBe('AUTHORIZED');

      // El rastro del AUTHORIZED es el estado/posición persistidos.
      expect(service.getStatus(1)).toEqual(
        expect.objectContaining({
          state: 'IDLE',
          position: FREE,
          positionQuality: 'RELIABLE',
        }),
      );
      // No contamina los registros de denegación/rechazo.
      expect(createIncidentRepository(db).findAll()).toHaveLength(0);
      expect(readAuditLog(db)).toHaveLength(0);
    });

    it('R5.1: una denegación queda registrada como incidente (rastro observable)', () => {
      const out = service.move(1, IN_STAIRS);
      expect(out.decision).toBe('DENIED');
      expect(createIncidentRepository(db).findAll()).toHaveLength(1);
    });

    it('R5.1: un rechazo por estado queda registrado en audit_log (rastro observable)', () => {
      service.move(1, IN_STAIRS); // → SAFE_STOP.
      service.move(1, FREE); // rechazo por estado → audit_log.
      expect(readAuditLog(db)).toHaveLength(1);
    });
  });

  describe('R5.2 · incidente solo en denegación que para', () => {
    it('R5.2: denegación geométrica (destino en zona activa) crea EXACTAMENTE un incidente', () => {
      const incidents = createIncidentRepository(db);
      expect(incidents.findAll()).toHaveLength(0);

      const out = service.move(1, IN_STAIRS);
      if (out.decision !== 'DENIED') throw new Error('se esperaba DENIED');
      expect(out.code).toBe('RESTRICTED_ZONE_VIOLATION');
      expect(out.incidentId).toBeGreaterThan(0);

      const all = incidents.findAll();
      expect(all).toHaveLength(1); // incremento de exactamente 1.
      expect(all[0]).toMatchObject({
        id: out.incidentId,
        decisionCode: 'RESTRICTED_ZONE_VIOLATION',
        collisionType: 'RESTRICTED_ZONE_VIOLATION',
        stateAfter: 'SAFE_STOP',
      });
      // zonesSnapshot refleja las dos zonas activas del seed.
      expect(
        incidents
          .findById(out.incidentId)
          ?.zonesSnapshot.map((z) => z.name)
          .sort(),
      ).toEqual(['Cuarto del bebé', 'Escaleras']);
      expect(service.getStatus(1).state).toBe('SAFE_STOP');
    });

    it('R5.2: denegación geométrica a otra zona activa también crea un incidente', () => {
      const out = service.move(1, IN_BABY_ROOM);
      if (out.decision !== 'DENIED') throw new Error('se esperaba DENIED');
      expect(out.code).toBe('RESTRICTED_ZONE_VIOLATION');
      const all = createIncidentRepository(db).findAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.destination).toEqual(IN_BABY_ROOM);
      expect(all[0]?.stateAfter).toBe('SAFE_STOP');
    });

    it('R5.2: denegación por datos UNRELIABLE (INSUFFICIENT_DATA) crea incidente → DEGRADED', () => {
      setRobotState(db, 1, {
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'UNRELIABLE',
      });
      const out = service.move(1, FREE);
      if (out.decision !== 'DENIED') throw new Error('se esperaba DENIED');
      expect(out.code).toBe('INSUFFICIENT_DATA');
      expect(out.state).toBe('DEGRADED');

      const all = createIncidentRepository(db).findAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        decisionCode: 'INSUFFICIENT_DATA',
        collisionType: null, // denegación por datos, sin causa geométrica.
        stateAfter: 'DEGRADED',
      });
    });

    it('R5.2: denegación por datos MISSING (MISSING_POSITION) crea incidente', () => {
      setRobotState(db, 1, {
        state: 'IDLE',
        position: { x: 120, y: 90 },
        positionQuality: 'MISSING',
      });
      const out = service.move(1, FREE);
      if (out.decision !== 'DENIED') throw new Error('se esperaba DENIED');
      expect(out.code).toBe('MISSING_POSITION');

      const all = createIncidentRepository(db).findAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        decisionCode: 'MISSING_POSITION',
        collisionType: null,
        stateAfter: out.state,
      });
    });

    it('R5.2: repositorio de zonas caído (ZONE_DATA_UNAVAILABLE) crea incidente → SAFE_STOP', () => {
      const failing = build(db, () => {
        throw new Error('zone repo down');
      });
      const out = failing.move(1, FREE);
      if (out.decision !== 'DENIED') throw new Error('se esperaba DENIED');
      expect(out.code).toBe('ZONE_DATA_UNAVAILABLE');
      expect(out.state).toBe('SAFE_STOP');

      const all = createIncidentRepository(db).findAll();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        decisionCode: 'ZONE_DATA_UNAVAILABLE',
        stateAfter: 'SAFE_STOP',
      });
      // zones = null → snapshot vacío (fallo seguro, DD-204).
      expect(createIncidentRepository(db).findById(all[0]?.id ?? 0)?.zonesSnapshot).toEqual([]);
    });
  });

  describe('R5.3 · rechazo por estado sin incidente, pero con audit_log', () => {
    it('R5.3: en SAFE_STOP un nuevo move → REJECTED/SAFE_STOP_ACTIVE sin incidente nuevo', () => {
      const incidents = createIncidentRepository(db);
      service.move(1, IN_STAIRS); // → SAFE_STOP + 1 incidente.
      expect(incidents.findAll()).toHaveLength(1);
      const auditBefore = readAuditLog(db).length;

      const out = service.move(1, FREE); // rechazo por estado.
      expect(out).toMatchObject({
        decision: 'REJECTED',
        code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
      });

      // No se crea un segundo incidente (recuento sin cambios).
      expect(incidents.findAll()).toHaveLength(1);
      // Sí se añade una fila a audit_log con el destino rechazado.
      const audit = readAuditLog(db);
      expect(audit).toHaveLength(auditBefore + 1);
      expect(audit[audit.length - 1]).toMatchObject({
        event_code: 'SAFE_STOP_ACTIVE',
        state: 'SAFE_STOP',
        x: FREE.x,
        y: FREE.y,
      });
      // R3.3: el estado y la posición no cambian por el rechazo.
      expect(service.getStatus(1)).toMatchObject({
        state: 'SAFE_STOP',
        position: { x: 120, y: 90 },
      });
    });

    it('R5.3: cada rechazo por estado sucesivo añade una fila de auditoría (append-only)', () => {
      service.move(1, IN_STAIRS); // → SAFE_STOP.
      service.move(1, FREE); // rechazo 1.
      service.move(1, FREE_2); // rechazo 2.

      const audit = readAuditLog(db);
      expect(audit).toHaveLength(2);
      expect(audit.map((r) => r.event_code)).toEqual(['SAFE_STOP_ACTIVE', 'SAFE_STOP_ACTIVE']);
      // Sigue habiendo un único incidente (el de la denegación original).
      expect(createIncidentRepository(db).findAll()).toHaveLength(1);
      // Nota: BUSY es inalcanzable vía el servicio (MOVING es transitorio y se completa en la
      // misma solicitud, DD-209); la rama BUSY se cubre a nivel de regla en guardian.test.ts.
    });
  });

  describe('R4.1 · recuperación válida', () => {
    it('R4.1: desde SAFE_STOP con posición segura y RELIABLE → recuperado a IDLE', () => {
      service.move(1, IN_STAIRS); // → SAFE_STOP; posición (120,90) sigue en Sala (inactiva).
      expect(service.getStatus(1)).toMatchObject({
        state: 'SAFE_STOP',
        positionQuality: 'RELIABLE',
      });

      const out = service.recover(1);
      expect(out).toMatchObject({
        kind: 'ok',
        value: { state: 'IDLE', position: { x: 120, y: 90 }, transitioned: true },
      });
      expect(service.getStatus(1).state).toBe('IDLE');
      // La posición se preserva en la recuperación.
      expect(service.getStatus(1).position).toEqual({ x: 120, y: 90 });
    });

    it('R4.1: desde DEGRADED con posición segura y RELIABLE → recuperado a IDLE', () => {
      setRobotState(db, 1, {
        state: 'DEGRADED',
        position: { x: 120, y: 90 },
        positionQuality: 'RELIABLE',
      });
      const out = service.recover(1);
      expect(out).toMatchObject({
        kind: 'ok',
        value: { state: 'IDLE', position: { x: 120, y: 90 }, transitioned: true },
      });
      expect(service.getStatus(1).state).toBe('IDLE');
    });
  });

  describe('R4.2 · recuperación inválida (permanece en parada, sin efectos)', () => {
    it('R4.2(a): positionQuality no RELIABLE → rechazada, estado y posición sin cambios', () => {
      service.move(1, IN_STAIRS); // → SAFE_STOP.
      createRobotRepository(db).saveQuality(1, 'UNRELIABLE');
      const snapshotBefore = service.getStatus(1);

      const out = service.recover(1);
      expect(out).toMatchObject({ kind: 'rejected', cause: 'UNRELIABLE_DATA' });
      // Sin efectos: snapshot idéntico al previo.
      expect(service.getStatus(1)).toEqual(snapshotBefore);
      expect(service.getStatus(1).state).toBe('SAFE_STOP');
    });

    it('R4.2(a bis): positionQuality MISSING → rechazada, permanece en parada', () => {
      setRobotState(db, 1, {
        state: 'SAFE_STOP',
        position: { x: 120, y: 90 },
        positionQuality: 'MISSING',
      });
      const out = service.recover(1);
      expect(out).toMatchObject({ kind: 'rejected', cause: 'UNRELIABLE_DATA' });
      expect(service.getStatus(1)).toMatchObject({
        state: 'SAFE_STOP',
        positionQuality: 'MISSING',
      });
    });

    it('R4.2(b): posición dentro de zona activa (insegura) → rechazada, permanece en parada', () => {
      setRobotState(db, 1, {
        state: 'SAFE_STOP',
        position: IN_STAIRS, // dentro de Escaleras (activa).
        positionQuality: 'RELIABLE',
      });
      const snapshotBefore = service.getStatus(1);

      const out = service.recover(1);
      expect(out).toMatchObject({ kind: 'rejected', cause: 'UNSAFE_POSITION' });
      expect(service.getStatus(1)).toEqual(snapshotBefore);
      expect(service.getStatus(1).state).toBe('SAFE_STOP');
    });
  });

  describe('R4.3 · recuperación fuera de parada', () => {
    it('R4.5: en IDLE la recuperación es idempotente (transitioned false) y solo se audita', () => {
      const snapshotBefore = service.getStatus(1);
      expect(snapshotBefore.state).toBe('IDLE');

      const out = service.recover(1);
      expect(out).toMatchObject({ kind: 'ok', value: { transitioned: false } });
      // Sin efectos de estado: no toca el snapshot ni crea incidente; solo audita RECOVER_NOOP.
      expect(service.getStatus(1)).toEqual(snapshotBefore);
      expect(createIncidentRepository(db).findAll()).toHaveLength(0);
      expect(readAuditLog(db)).toEqual([
        expect.objectContaining({ event_code: 'RECOVER_NOOP', state: 'IDLE' }),
      ]);
    });
  });
});

describe('VERIFICAR · bootstrap reinicio seguro ADR-10 (trazabilidad de requisitos)', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
  });

  it('R6.1: tras migrar+sembrar, bootstrap deja IDLE y RELIABLE (no fuerza MISSING/UNRELIABLE)', () => {
    bootstrap(db);
    const snapshot = getRobotState(db, 1);
    expect(snapshot.state).toBe('IDLE');
    expect(snapshot.positionQuality).toBe('RELIABLE');
    expect(snapshot.position).toEqual({ x: 120, y: 90 });
  });

  it('R6.2: un MOVING persistido se degrada a SAFE_STOP conservando posición y calidad', () => {
    setRobotState(db, 1, {
      state: 'MOVING',
      position: { x: 42, y: 17 },
      positionQuality: 'RELIABLE',
    });

    bootstrap(db);

    const snapshot = getRobotState(db, 1);
    expect(snapshot.state).toBe('SAFE_STOP'); // no reanuda un movimiento a ciegas.
    expect(snapshot.position).toEqual({ x: 42, y: 17 });
    expect(snapshot.positionQuality).toBe('RELIABLE'); // la calidad se preserva.
  });

  it('R6.2: estado no-MOVING no se altera en el reinicio (p. ej. IDLE permanece IDLE)', () => {
    setRobotState(db, 1, {
      state: 'IDLE',
      position: { x: 70, y: 80 },
      positionQuality: 'RELIABLE',
    });

    bootstrap(db);

    expect(getRobotState(db, 1)).toEqual({
      state: 'IDLE',
      position: { x: 70, y: 80 },
      positionQuality: 'RELIABLE',
    });
  });
});
