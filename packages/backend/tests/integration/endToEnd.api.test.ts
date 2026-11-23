import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createTestDb } from '../helpers.js';

// Spec 002 — RC-21 (R4, R5, R9, R11, R12; Property 11, 14, 16): integración Supertest de extremo a
// extremo sobre la app REAL (`createApp`: catálogo, sesiones, vigilante, incidentes y zonas de la
// spec 001). Una sola secuencia encadenada; tras cada paso se comprueban las filas exactas de
// `state_transition_log`, `audit_log` e `incidents` que ese paso debía producir (y solo esas).

const START = { x: 120, y: 90 };
const FREE = { x: 450, y: 120 };
// Zona que cubre la posición de inicio (120, 90) de todo robot nuevo.
const START_ZONE = { name: 'Sala E2E', x: 100, y: 60, width: 100, height: 80 };

interface AuditRow {
  robot_id: number | null;
  event_code: string;
  state: string | null;
}

describe('API de extremo a extremo: alta → sesión → denegación → recuperación (spec 002 RC-21)', () => {
  let db: Db;
  let app: Express;

  beforeEach(() => {
    db = createTestDb();
    app = createApp(db, { corsOrigins: ['http://localhost:5173'] });
  });

  const audit = () =>
    (
      db
        .prepare('SELECT robot_id, event_code, state FROM audit_log ORDER BY id')
        .all() as AuditRow[]
    ).map((r) => [r.robot_id, r.event_code, r.state]);
  const transitions = (robotId: number) =>
    createTransitionLogRepository(db)
      .findByRobot(robotId)
      .map((t) => [t.fromState, t.toState, t.cause]);
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const incidents = async () => (await request(app).get('/api/incidents')).body as unknown[];

  it('recorre la secuencia completa y deja exactamente las filas esperadas', async () => {
    // ── 1. Alta de robot: 201, IDLE / RELIABLE en (120, 90) y T9 ROBOT_REGISTERED ─────────────
    const created = await request(app)
      .post('/api/robots')
      .send({ name: 'Aspiradora E2E', type: 'VACUUM' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      id: 3,
      name: 'Aspiradora E2E',
      type: 'VACUUM',
      state: 'IDLE',
      position: START,
      positionQuality: 'RELIABLE',
      lastRequest: null,
    });
    expect(transitions(3)).toEqual([[null, 'IDLE', 'ROBOT_REGISTERED']]);
    expect(audit()).toEqual([]);

    // ── 2. Alta en zona activa: 409 auditado SIN robot ni estado ──────────────────────────────
    const zone = await request(app).post('/api/zones').send(START_ZONE);
    expect(zone.status).toBe(201);
    const zoneId = zone.body.id as number;

    const inZone = await request(app)
      .post('/api/robots')
      .send({ name: 'Rechazado', type: 'GUARD' });
    expect(inZone.status).toBe(409);
    expect(inZone.body).toEqual({
      code: 'ROBOT_START_IN_RESTRICTED_ZONE',
      message: expect.any(String),
    });
    // Nada se creó: ni robot, ni estado, ni transición. La fila de auditoría ya está confirmada.
    expect(count('robots')).toBe(3);
    expect(count('robot_state')).toBe(3);
    expect(audit()).toEqual([[null, 'ROBOT_START_IN_RESTRICTED_ZONE', null]]);

    // ── 3. Sesión del robot 3 ─────────────────────────────────────────────────────────────────
    const session = await request(app).post('/api/robots/3/sessions');
    expect(session.status).toBe(201);
    const sessionId = session.body.sessionId as string;
    expect(audit()).toEqual([
      [null, 'ROBOT_START_IN_RESTRICTED_ZONE', null],
      [3, 'SESSION_STARTED', 'IDLE'],
    ]);

    // ── 4. Move denegado: el origen está dentro de la zona activa → incidente y SAFE_STOP ────
    const body1 = { destination: FREE, sessionId, sequence: 1 };
    const denied = await request(app).post('/api/robots/3/move').send(body1);
    expect(denied.status).toBe(200);
    expect(denied.body).toMatchObject({
      decision: 'DENIED',
      code: 'ORIGIN_IN_RESTRICTED_ZONE',
      state: 'SAFE_STOP',
      position: START,
      rule: 'R-ZONA-01',
      zoneName: 'Sala E2E',
      robotId: 3,
    });
    const incidentId = denied.body.incidentId as number;
    expect(await incidents()).toEqual([
      expect.objectContaining({
        id: incidentId,
        robotId: 3,
        rule: 'R-ZONA-01',
        zoneName: 'Sala E2E',
        decisionCode: 'ORIGIN_IN_RESTRICTED_ZONE',
        stateAfter: 'SAFE_STOP',
        origin: START,
        destination: FREE,
      }),
    ]);
    expect(transitions(3)).toEqual([
      [null, 'IDLE', 'ROBOT_REGISTERED'],
      ['IDLE', 'SAFE_STOP', 'ORIGIN_IN_RESTRICTED_ZONE'],
    ]);
    const deniedRow = createTransitionLogRepository(db).findByRobot(3)[1];
    expect(deniedRow?.detail).toMatchObject({ incidentId });

    // ── 5. La misma secuencia: 409 DUPLICATE_EVENT, auditado, sin incidente ni transición ────
    const duplicate = await request(app).post('/api/robots/3/move').send(body1);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ code: 'DUPLICATE_EVENT', message: expect.any(String) });
    expect(audit().at(-1)).toEqual([3, 'DUPLICATE_EVENT', 'SAFE_STOP']);
    expect(await incidents()).toHaveLength(1);
    expect(transitions(3)).toHaveLength(2);

    // ── 6. Siguiente movimiento: 409 REJECTED SAFE_STOP_ACTIVE, auditado, sin incidente ──────
    const rejected = await request(app)
      .post('/api/robots/3/move')
      .send({ destination: FREE, sessionId, sequence: 2 });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({
      decision: 'REJECTED',
      code: 'SAFE_STOP_ACTIVE',
      state: 'SAFE_STOP',
      position: START,
    });
    expect(audit().at(-1)).toEqual([3, 'SAFE_STOP_ACTIVE', 'SAFE_STOP']);
    expect(await incidents()).toHaveLength(1);
    expect(transitions(3)).toHaveLength(2);

    // ── 7. Recover con el robot dentro de la zona activa: 409 UNSAFE_POSITION ────────────────
    const unsafe = await request(app).post('/api/robots/3/recover');
    expect(unsafe.status).toBe(409);
    expect(unsafe.body).toEqual({
      code: 'RECOVERY_NOT_ALLOWED',
      cause: 'UNSAFE_POSITION',
      message: expect.any(String),
    });
    expect(audit().at(-1)).toEqual([3, 'RECOVERY_NOT_ALLOWED', 'SAFE_STOP']);
    expect(transitions(3)).toHaveLength(2);

    // ── 8. Desactivar la zona (spec 001) → recover OK (T6 + T7) ──────────────────────────────
    const transitionsBeforeZoneChange = transitions(3);
    const deactivated = await request(app).put(`/api/zones/${zoneId}`).send({ active: false });
    expect(deactivated.status).toBe(200);
    // RC-22: el registro de cambios de zona (spec 001, migración 013) no altera al vigilante.
    expect(
      (await request(app).get('/api/zones/changes')).body.map((c: { action: string }) => c.action),
    ).toEqual(['DEACTIVATE', 'CREATE']);
    expect(transitions(3)).toEqual(transitionsBeforeZoneChange);
    expect((await request(app).get('/api/robots/3/state')).body.state).toBe('SAFE_STOP');

    const recovered = await request(app).post('/api/robots/3/recover');
    expect(recovered.status).toBe(200);
    expect(recovered.body).toEqual({
      robotId: 3,
      state: 'IDLE',
      position: START,
      positionQuality: 'RELIABLE',
      transitioned: true,
    });
    expect(transitions(3)).toEqual([
      [null, 'IDLE', 'ROBOT_REGISTERED'],
      ['IDLE', 'SAFE_STOP', 'ORIGIN_IN_RESTRICTED_ZONE'],
      ['SAFE_STOP', 'RECOVERING', 'RECOVER_REQUESTED'],
      ['RECOVERING', 'IDLE', 'RECOVER_COMPLETED'],
    ]);

    // ── 9. Alta con zonas no legibles: 409 ROBOT_START_NOT_VERIFIABLE con cause, sin robot ───
    const robotsBefore = count('robots');
    db.exec('ALTER TABLE zones RENAME TO zones_unavailable');
    let notVerifiable;
    try {
      notVerifiable = await request(app)
        .post('/api/robots')
        .send({ name: 'Sin zonas', type: 'GUARD' });
    } finally {
      db.exec('ALTER TABLE zones_unavailable RENAME TO zones');
    }
    expect(notVerifiable.status).toBe(409);
    expect(notVerifiable.body).toEqual({
      code: 'ROBOT_START_NOT_VERIFIABLE',
      cause: 'ZONE_DATA_UNAVAILABLE',
      message: expect.any(String),
    });
    expect(count('robots')).toBe(robotsBefore);
    expect(count('robot_state')).toBe(robotsBefore);
    expect(audit().at(-1)).toEqual([null, 'ROBOT_START_NOT_VERIFIABLE', null]);
    const notVerifiableRow = db
      .prepare("SELECT detail FROM audit_log WHERE event_code = 'ROBOT_START_NOT_VERIFIABLE'")
      .get() as { detail: string };
    expect(JSON.parse(notVerifiableRow.detail)).toMatchObject({ cause: 'ZONE_DATA_UNAVAILABLE' });

    // ── 10. Señal de pérdida: DEGRADED con incidente R-SIGNAL-01 (T5) ────────────────────────
    const loss = await request(app)
      .post('/api/robots/3/position')
      .send({ position: START, quality: 'MISSING' });
    expect(loss.status).toBe(200);
    expect(loss.body).toEqual({ state: 'DEGRADED', position: START, positionQuality: 'MISSING' });
    const afterLoss = (await incidents()) as Array<Record<string, unknown>>;
    expect(afterLoss).toHaveLength(2);
    expect(afterLoss[0]).toMatchObject({
      robotId: 3,
      rule: 'R-SIGNAL-01',
      zoneName: null,
      decisionCode: 'POSITION_QUALITY_LOST',
      stateAfter: 'DEGRADED',
      origin: START,
      destination: START,
    });
    expect(afterLoss[1]).toMatchObject({ id: incidentId, rule: 'R-ZONA-01' });
    expect(transitions(3).at(-1)).toEqual(['IDLE', 'DEGRADED', 'POSITION_QUALITY_LOST']);

    // ── 11. Lectura RELIABLE coincidente → recover OK (DEGRADED → RECOVERING → IDLE) ─────────
    const reading = await request(app)
      .post('/api/robots/3/position')
      .send({ position: START, quality: 'RELIABLE' });
    expect(reading.status).toBe(200);
    expect(reading.body).toEqual({
      state: 'DEGRADED',
      position: START,
      positionQuality: 'RELIABLE',
    });
    const recoveredAgain = await request(app).post('/api/robots/3/recover');
    expect(recoveredAgain.status).toBe(200);
    expect(recoveredAgain.body).toMatchObject({ state: 'IDLE', transitioned: true });

    // ── Filas finales exactas ─────────────────────────────────────────────────────────────────
    expect(transitions(3)).toEqual([
      [null, 'IDLE', 'ROBOT_REGISTERED'],
      ['IDLE', 'SAFE_STOP', 'ORIGIN_IN_RESTRICTED_ZONE'],
      ['SAFE_STOP', 'RECOVERING', 'RECOVER_REQUESTED'],
      ['RECOVERING', 'IDLE', 'RECOVER_COMPLETED'],
      ['IDLE', 'DEGRADED', 'POSITION_QUALITY_LOST'],
      ['DEGRADED', 'RECOVERING', 'RECOVER_REQUESTED'],
      ['RECOVERING', 'IDLE', 'RECOVER_COMPLETED'],
    ]);
    expect(audit()).toEqual([
      [null, 'ROBOT_START_IN_RESTRICTED_ZONE', null],
      [3, 'SESSION_STARTED', 'IDLE'],
      [3, 'DUPLICATE_EVENT', 'SAFE_STOP'],
      [3, 'SAFE_STOP_ACTIVE', 'SAFE_STOP'],
      [3, 'RECOVERY_NOT_ALLOWED', 'SAFE_STOP'],
      [null, 'ROBOT_START_NOT_VERIFIABLE', null],
      [3, 'POSITION_READING', 'IDLE'],
      [3, 'POSITION_READING', 'DEGRADED'],
    ]);
    expect(
      (
        db
          .prepare('SELECT robot_id, rule, decision_code FROM incidents ORDER BY id')
          .all() as Array<{
          robot_id: number;
          rule: string;
          decision_code: string;
        }>
      ).map((i) => [i.robot_id, i.rule, i.decision_code]),
    ).toEqual([
      [3, 'R-ZONA-01', 'ORIGIN_IN_RESTRICTED_ZONE'],
      [3, 'R-SIGNAL-01', 'POSITION_QUALITY_LOST'],
    ]);
    // A1 y V2 no se vieron afectados (R12.4): solo conservan su fila base.
    expect(transitions(1)).toEqual([[null, 'IDLE', 'MIGRATION_BASELINE']]);
    expect(transitions(2)).toEqual([[null, 'IDLE', 'MIGRATION_BASELINE']]);
  });
});
