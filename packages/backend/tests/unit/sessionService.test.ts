import type { MoveCommand, RobotStateName } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { createSessionRepository } from '../../src/repositories/sessionRepository.js';
import { createSessionService, type SessionService } from '../../src/services/sessionService.js';
import { createTestDb } from '../helpers.js';

// Spec 003 — RC-7 (RF-08.1, RF-08.4, RF-08.5, RF-08.8, RF-08.9, DD-117, DD-132; CA-03.34):
// sessionService.startSession / acceptRequest / getLastRequest sobre repos reales en memoria.

const FIXED_ID = '11111111-1111-4111-8111-111111111111';

function build(db: Db, newSessionId?: () => string): SessionService {
  return createSessionService({
    sessions: createSessionRepository(db),
    audit: createAuditLogRepository(db),
    robots: createRobotRepository(db),
    runInTransaction: (fn) => db.transaction(fn)(),
    ...(newSessionId ? { newSessionId } : {}),
  });
}

/** Filas crudas de `audit_log` en orden de inserción (leídas tras confirmar la transacción). */
function readAudit(db: Db): Array<Record<string, unknown>> {
  return db
    .prepare('SELECT robot_id, event_code, state, x, y, detail FROM audit_log ORDER BY id')
    .all() as Array<Record<string, unknown>>;
}

function cmd(sessionId: string, sequence: number, x = 250, y = 175): MoveCommand {
  return { destination: { x, y }, sessionId, sequence };
}

describe('sessionService', () => {
  let db: Db;
  let service: SessionService;

  beforeEach(() => {
    db = createTestDb();
    service = build(db);
  });

  describe('startSession', () => {
    it('genera un UUID y lo deja como sesión vigente con last_sequence = 0', () => {
      const { sessionId } = service.startSession(1);
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(createSessionRepository(db).findSessionId(1)).toBe(sessionId);
      expect(createSessionRepository(db).findLastSequence(1)).toBe(0);
      expect(service.getLastRequest(1)).toBeNull();
    });

    it('invalida la sesión anterior y reinicia la secuencia', () => {
      const first = service.startSession(1).sessionId;
      expect(service.acceptRequest(1, cmd(first, 5), 'IDLE').kind).toBe('ok');
      const second = service.startSession(1).sessionId;
      expect(second).not.toBe(first);
      expect(service.getLastRequest(1)).toBeNull();
      const stale = service.acceptRequest(1, cmd(first, 6), 'IDLE');
      expect(stale).toMatchObject({ kind: 'rejected', code: 'INVALID_SESSION', status: 409 });
      expect(service.acceptRequest(1, cmd(second, 1), 'IDLE').kind).toBe('ok');
    });

    it('audita SESSION_STARTED con robot_id y el estado leído de getStatus (CA-03.34)', () => {
      const { sessionId } = service.startSession(2);
      const rows = readAudit(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ robot_id: 2, event_code: 'SESSION_STARTED', state: 'IDLE' });
      expect(JSON.parse(rows[0]?.detail as string)).toEqual({ sessionId });
    });

    it('usa el generador inyectado para el identificador', () => {
      const injected = build(db, () => FIXED_ID);
      expect(injected.startSession(1).sessionId).toBe(FIXED_ID);
    });

    it('robot inexistente: 404 ROBOT_NOT_FOUND y sin auditoría ni sesión', () => {
      expect(() => service.startSession(99)).toThrowError(
        expect.objectContaining({ status: 404, code: 'ROBOT_NOT_FOUND' }),
      );
      expect(readAudit(db)).toHaveLength(0);
    });

    it('las sesiones de dos robots son independientes (Property 15)', () => {
      const a = service.startSession(1).sessionId;
      const b = service.startSession(2).sessionId;
      expect(service.acceptRequest(1, cmd(a, 1), 'IDLE').kind).toBe('ok');
      expect(service.acceptRequest(2, cmd(a, 1), 'IDLE')).toMatchObject({
        kind: 'rejected',
        code: 'INVALID_SESSION',
      });
      expect(service.acceptRequest(2, cmd(b, 1), 'IDLE').kind).toBe('ok');
    });
  });

  describe('acceptRequest', () => {
    it('acepta una solicitud válida: devuelve ok con LastRequest y lo persiste', () => {
      const { sessionId } = service.startSession(1);
      const result = service.acceptRequest(1, cmd(sessionId, 1, 300, 200), 'IDLE');
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') throw new Error('se esperaba ok');
      expect(result.value).toEqual({
        sessionId,
        sequence: 1,
        destination: { x: 300, y: 200 },
        acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
      expect(service.getLastRequest(1)).toEqual(result.value);
    });

    it('la secuencia solo debe crecer: 1, 3 y 10 se aceptan sin ser consecutivas', () => {
      const { sessionId } = service.startSession(1);
      for (const sequence of [1, 3, 10]) {
        expect(service.acceptRequest(1, cmd(sessionId, sequence), 'IDLE').kind).toBe('ok');
      }
      expect(service.getLastRequest(1)?.sequence).toBe(10);
    });

    it('no acepta sin sesión: INVALID_SESSION sin lanzar, sin consumir secuencia', () => {
      const result = service.acceptRequest(
        1,
        cmd('22222222-2222-4222-8222-222222222222', 1),
        'IDLE',
      );
      expect(result).toMatchObject({ kind: 'rejected', code: 'INVALID_SESSION', status: 409 });
      expect(service.getLastRequest(1)).toBeNull();
    });

    it('INVALID_SESSION: audita con robot_id, el currentState recibido y el destino en x/y', () => {
      service.startSession(1);
      const before = readAudit(db).length;
      service.acceptRequest(
        1,
        cmd('33333333-3333-4333-8333-333333333333', 4, 111, 222),
        'SAFE_STOP',
      );
      const rows = readAudit(db);
      expect(rows).toHaveLength(before + 1);
      expect(rows[rows.length - 1]).toMatchObject({
        robot_id: 1,
        event_code: 'INVALID_SESSION',
        state: 'SAFE_STOP',
        x: 111,
        y: 222,
      });
    });

    it.each([1, 2])(
      'DUPLICATE_EVENT con sequence %i (<= última 2): rechazado y auditado, última solicitud intacta',
      (sequence) => {
        const { sessionId } = service.startSession(1);
        service.acceptRequest(1, cmd(sessionId, 2, 300, 200), 'IDLE');
        const last = service.getLastRequest(1);
        const before = readAudit(db).length;

        const result = service.acceptRequest(1, cmd(sessionId, sequence, 9, 9), 'DEGRADED');

        expect(result).toMatchObject({ kind: 'rejected', code: 'DUPLICATE_EVENT', status: 409 });
        if (result.kind !== 'rejected') throw new Error('se esperaba rejected');
        expect(result.message).toContain(String(sequence));
        expect(service.getLastRequest(1)).toEqual(last);
        const rows = readAudit(db);
        expect(rows).toHaveLength(before + 1);
        expect(rows[rows.length - 1]).toMatchObject({
          robot_id: 1,
          event_code: 'DUPLICATE_EVENT',
          state: 'DEGRADED',
          x: 9,
          y: 9,
        });
      },
    );

    it('la sesión se comprueba antes que la secuencia (orden de checkSequence)', () => {
      const { sessionId } = service.startSession(1);
      service.acceptRequest(1, cmd(sessionId, 5), 'IDLE');
      const result = service.acceptRequest(
        1,
        cmd('44444444-4444-4444-8444-444444444444', 1),
        'IDLE',
      );
      expect(result).toMatchObject({ kind: 'rejected', code: 'INVALID_SESSION' });
    });

    it('una aceptación no audita nada (solo los rechazos y SESSION_STARTED)', () => {
      const { sessionId } = service.startSession(1);
      const before = readAudit(db).length;
      service.acceptRequest(1, cmd(sessionId, 1), 'IDLE');
      expect(readAudit(db)).toHaveLength(before);
    });

    it('un rechazo no lanza y su fila queda confirmada aunque la transacción envolvente termine bien', () => {
      const { sessionId } = service.startSession(1);
      const outcome = db.transaction(() =>
        service.acceptRequest(1, cmd(sessionId, 0 + 1), 'IDLE'),
      )();
      expect(outcome.kind).toBe('ok');
      const rejected = db.transaction(() => service.acceptRequest(1, cmd(sessionId, 1), 'IDLE'))();
      expect(rejected.kind).toBe('rejected');
      expect(readAudit(db).filter((r) => r.event_code === 'DUPLICATE_EVENT')).toHaveLength(1);
    });
  });

  describe('getLastRequest', () => {
    it('devuelve null sin sesión o sin solicitudes aceptadas', () => {
      expect(service.getLastRequest(1)).toBeNull();
      service.startSession(1);
      expect(service.getLastRequest(1)).toBeNull();
    });

    it('acepta cualquier estado de robot al auditar (los 5 valores)', () => {
      const states: RobotStateName[] = ['IDLE', 'MOVING', 'SAFE_STOP', 'DEGRADED', 'RECOVERING'];
      for (const state of states) {
        service.acceptRequest(1, cmd('55555555-5555-4555-8555-555555555555', 1), state);
      }
      expect(readAudit(db).map((r) => r.state)).toEqual(states);
    });
  });
});
