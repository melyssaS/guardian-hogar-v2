import type { MoveCommand, Point } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createZoneRepository } from '../../src/repositories/zoneRepository.js';
import { createGuardianService, type GuardianService } from '../../src/services/guardianService.js';
import type { SessionService } from '../../src/services/sessionService.js';
import { createTestDb, createTestSessions } from '../helpers.js';

// Spec 002 — RC-16 (R11, R1.8, R1.9, Property 14, 15, 16): `move(robotId, MoveCommand)` invoca
// `sessionService.acceptRequest` antes del vigilante y respeta el orden de validación de R11.5:
// robot existe (404) → límites del plano (422) → sesión (409) → secuencia (409) → vigilante.

const HOME: Point = { x: 120, y: 90 };
const FREE: Point = { x: 450, y: 120 };
const IN_STAIRS: Point = { x: 100, y: 300 };

/** `decision` del resultado, o `code` si fue un rechazo previo al vigilante (sesión/secuencia). */
const decision = (r: ReturnType<GuardianService['move']>): string =>
  'decision' in r ? r.decision : r.code;

describe('guardianService.move con sesión y secuencia', () => {
  let db: Db;
  let service: GuardianService;
  let sessions: SessionService;
  let robots: ReturnType<typeof createRobotRepository>;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    const zones = createZoneRepository(db);
    robots = createRobotRepository(db);
    sessions = createTestSessions(db);
    service = createGuardianService({
      robots,
      incidents: createIncidentRepository(db),
      audit: createAuditLogRepository(db),
      transitions: createTransitionLogRepository(db),
      sessions,
      getActiveZones: () => zones.findAll('active'),
      runInTransaction: (fn) => db.transaction(fn)(),
      pad: 0,
    });
  });

  const cmd = (sessionId: string, sequence: number, destination: Point): MoveCommand => ({
    destination,
    sessionId,
    sequence,
  });
  const auditRows = () =>
    db
      .prepare('SELECT robot_id, event_code, state, x, y FROM audit_log ORDER BY id')
      .all() as Array<Record<string, unknown>>;
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it('AUTHORIZED: añade robotId y positionQuality y persiste la última solicitud (lastRequest)', () => {
    const { sessionId } = sessions.startSession(1);
    const out = service.move(1, cmd(sessionId, 1, FREE));
    expect(out).toEqual({
      decision: 'AUTHORIZED',
      state: 'IDLE',
      position: FREE,
      robotId: 1,
      positionQuality: 'RELIABLE',
    });
    expect(service.getStatus(1)).toEqual({
      robotId: 1,
      state: 'IDLE',
      position: FREE,
      positionQuality: 'RELIABLE',
      lastRequest: {
        sessionId,
        sequence: 1,
        destination: FREE,
        acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    });
  });

  it('DENIED: añade robotId, positionQuality, rule y zoneName', () => {
    const { sessionId } = sessions.startSession(1);
    const out = service.move(1, cmd(sessionId, 1, IN_STAIRS));
    expect(out).toMatchObject({
      decision: 'DENIED',
      code: 'RESTRICTED_ZONE_VIOLATION',
      state: 'SAFE_STOP',
      robotId: 1,
      positionQuality: 'RELIABLE',
      rule: 'R-ZONA-01',
      zoneName: 'Escaleras',
      incidentId: expect.any(Number),
    });
  });

  it('REJECTED por estado: añade robotId y positionQuality y audita con el robot', () => {
    const { sessionId } = sessions.startSession(2);
    service.move(2, cmd(sessionId, 1, IN_STAIRS)); // V2 → SAFE_STOP
    const out = service.move(2, cmd(sessionId, 2, FREE));
    expect(out).toMatchObject({
      decision: 'REJECTED',
      code: 'SAFE_STOP_ACTIVE',
      robotId: 2,
      positionQuality: 'RELIABLE',
    });
    expect(auditRows().filter((r) => r.event_code === 'SAFE_STOP_ACTIVE')).toEqual([
      { robot_id: 2, event_code: 'SAFE_STOP_ACTIVE', state: 'SAFE_STOP', x: FREE.x, y: FREE.y },
    ]);
  });

  it('R11.5 robot inexistente → 404 ROBOT_NOT_FOUND antes que cualquier otra comprobación', () => {
    expect(() =>
      service.move(99, cmd('11111111-1111-4111-8111-111111111111', 1, { x: 9999, y: 9999 })),
    ).toThrowError(expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }));
  });

  it('R11.5 límites del plano → 422 antes que la sesión, sin auditar ni consumir secuencia', () => {
    const { sessionId } = sessions.startSession(1);
    const before = auditRows().length;
    expect(() =>
      service.move(1, cmd('22222222-2222-4222-8222-222222222222', 1, { x: 5000, y: 5 })),
    ).toThrowError(expect.objectContaining({ status: 422, code: 'DESTINATION_OUT_OF_BOUNDS' }));
    expect(auditRows()).toHaveLength(before);
    // La secuencia 1 sigue disponible.
    expect(service.move(1, cmd(sessionId, 1, FREE))).toMatchObject({ decision: 'AUTHORIZED' });
  });

  it('R11.3 sesión inválida: rejected 409 INVALID_SESSION, sin evaluar, sin incidente ni transición', () => {
    sessions.startSession(1);
    const transitionsBefore = count('state_transition_log');
    const out = service.move(1, cmd('33333333-3333-4333-8333-333333333333', 1, IN_STAIRS));
    expect(out).toMatchObject({ kind: 'rejected', code: 'INVALID_SESSION', status: 409 });
    expect(robots.getStatus(1)).toMatchObject({ state: 'IDLE', position: HOME });
    expect(count('incidents')).toBe(0);
    expect(count('state_transition_log')).toBe(transitionsBefore);
    // Property 16: la fila de auditoría queda confirmada.
    expect(auditRows().filter((r) => r.event_code === 'INVALID_SESSION')).toEqual([
      { robot_id: 1, event_code: 'INVALID_SESSION', state: 'IDLE', x: IN_STAIRS.x, y: IN_STAIRS.y },
    ]);
  });

  it('un robot sin sesión (nunca inició una) también recibe INVALID_SESSION', () => {
    expect(service.move(1, cmd('44444444-4444-4444-8444-444444444444', 1, FREE))).toMatchObject({
      kind: 'rejected',
      code: 'INVALID_SESSION',
    });
  });

  it('R11.4 secuencia repetida o menor: rejected 409 DUPLICATE_EVENT, sin crear incidente', () => {
    const { sessionId } = sessions.startSession(1);
    service.move(1, cmd(sessionId, 5, FREE));
    for (const sequence of [5, 4, 1]) {
      expect(service.move(1, cmd(sessionId, sequence, IN_STAIRS))).toMatchObject({
        kind: 'rejected',
        code: 'DUPLICATE_EVENT',
        status: 409,
      });
    }
    expect(count('incidents')).toBe(0);
    expect(robots.getStatus(1)).toMatchObject({ state: 'IDLE', position: FREE });
    expect(auditRows().filter((r) => r.event_code === 'DUPLICATE_EVENT')).toHaveLength(3);
  });

  it('Property 14: la secuencia solo crece; con huecos se acepta', () => {
    const { sessionId } = sessions.startSession(1);
    expect(decision(service.move(1, cmd(sessionId, 1, FREE)))).toBe('AUTHORIZED');
    expect(decision(service.move(1, cmd(sessionId, 10, { x: 500, y: 150 })))).toBe('AUTHORIZED');
    expect(service.move(1, cmd(sessionId, 9, FREE))).toMatchObject({ code: 'DUPLICATE_EVENT' });
  });

  it('R11.5 la solicitud que supera la secuencia la consume, decida lo que decida el vigilante', () => {
    const { sessionId } = sessions.startSession(1);
    expect(decision(service.move(1, cmd(sessionId, 1, IN_STAIRS)))).toBe('DENIED');
    // Mismo número reenviado tras la denegación: duplicado, no una segunda denegación.
    expect(service.move(1, cmd(sessionId, 1, IN_STAIRS))).toMatchObject({
      code: 'DUPLICATE_EVENT',
    });
    expect(count('incidents')).toBe(1);
    // También se consume cuando el vigilante rechaza por estado (SAFE_STOP_ACTIVE).
    expect(decision(service.move(1, cmd(sessionId, 2, FREE)))).toBe('REJECTED');
    expect(service.move(1, cmd(sessionId, 2, FREE))).toMatchObject({ code: 'DUPLICATE_EVENT' });
    expect(service.getStatus(1).lastRequest?.sequence).toBe(2);
  });

  it('una nueva sesión invalida la anterior y reinicia la secuencia', () => {
    const first = sessions.startSession(1).sessionId;
    service.move(1, cmd(first, 7, FREE));
    const second = sessions.startSession(1).sessionId;
    expect(service.move(1, cmd(first, 8, FREE))).toMatchObject({ code: 'INVALID_SESSION' });
    expect(service.move(1, cmd(second, 1, { x: 500, y: 150 }))).toMatchObject({
      decision: 'AUTHORIZED',
    });
  });

  it('R9.2: T1 registra destino, sesión y secuencia en el detail', () => {
    const { sessionId } = sessions.startSession(1);
    service.move(1, cmd(sessionId, 3, FREE));
    const rows = createTransitionLogRepository(db).findByRobot(1);
    expect(rows[1]).toMatchObject({ toState: 'MOVING', cause: 'AUTHORIZED' });
    expect(rows[1]?.detail).toEqual({ destination: FREE, sessionId, sequence: 3 });
  });

  it('Property 15: la sesión y el estado de cada robot son independientes', () => {
    const a = sessions.startSession(1).sessionId;
    const b = sessions.startSession(2).sessionId;
    expect(service.move(1, cmd(b, 1, FREE))).toMatchObject({ code: 'INVALID_SESSION' });
    expect(decision(service.move(2, cmd(b, 1, IN_STAIRS)))).toBe('DENIED');
    expect(robots.getStatus(1)).toMatchObject({ state: 'IDLE', position: HOME });
    expect(decision(service.move(1, cmd(a, 1, FREE)))).toBe('AUTHORIZED');
    expect(robots.getStatus(2)?.state).toBe('SAFE_STOP');
  });

  it('getStatus: lastRequest nulo sin solicitudes y 404 si el robot no existe', () => {
    expect(service.getStatus(1)).toMatchObject({ robotId: 1, lastRequest: null });
    expect(() => service.getStatus(99)).toThrowError(
      expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }),
    );
  });
});
