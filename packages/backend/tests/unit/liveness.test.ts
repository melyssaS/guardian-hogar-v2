import type { Point } from '@home-guardian/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createAuditLogRepository } from '../../src/repositories/auditLogRepository.js';
import { createIncidentRepository } from '../../src/repositories/incidentRepository.js';
import { createTransitionLogRepository } from '../../src/repositories/transitionLogRepository.js';
import { createRobotRepository } from '../../src/repositories/robotRepository.js';
import { completeMove } from '../../src/rules/stateMachine.js';
import { createTestDb, createTestGuardian, type TestGuardian } from '../helpers.js';

// Vivacidad del movimiento (R1.5, §2.2 "MOVING transitorio", Property 9, DD-209).
//
// Un movimiento autorizado deja el robot en MOVING solo de forma transitoria: `completeMove`
// lo lleva de vuelta a IDLE dentro de la misma solicitud. Por tanto, dos (o más) movimientos
// válidos consecutivos deben autorizarse ambos; ninguno puede rechazarse con BUSY porque el
// anterior jamás queda atascado en MOVING.
//
// Robot sembrado: IDLE en (120, 90), positionQuality RELIABLE.
// Usamos `getActiveZones: () => []` para que la geometría nunca deniegue y aislar la vivacidad.

/** Construye el servicio sobre repos reales en memoria, sin zonas activas (geometría libre). */
function build(db: Db): TestGuardian {
  return createTestGuardian(db, {
    robots: createRobotRepository(db),
    incidents: createIncidentRepository(db),
    audit: createAuditLogRepository(db),
    transitions: createTransitionLogRepository(db),
    getActiveZones: () => [],
    runInTransaction: (fn) => db.transaction(fn)(),
    pad: 0,
  });
}

// Destinos libres y dentro del plano (FLOOR_WIDTH 1000, FLOOR_HEIGHT 800).
const DEST_A: Point = { x: 400, y: 200 };
const DEST_B: Point = { x: 600, y: 300 };
const DEST_C: Point = { x: 800, y: 500 };

describe('Vivacidad del movimiento', () => {
  let db: Db;
  let service: TestGuardian;

  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    service = build(db);
  });

  it('dos movimientos válidos consecutivos se autorizan ambos (ninguno queda en MOVING/BUSY)', () => {
    // Primer movimiento: autorizado y el robot queda en IDLE (MOVING transitorio → completeMove).
    const first = service.move(1, DEST_A);
    expect(first).toMatchObject({ decision: 'AUTHORIZED', state: 'IDLE', position: DEST_A });
    expect(service.getState(1)).toEqual({
      state: 'IDLE',
      position: DEST_A,
      positionQuality: 'RELIABLE',
    });

    // Segundo movimiento inmediato: también autorizado. Si el primero hubiese dejado el robot
    // atascado en MOVING, este sería rechazado con BUSY; la vivacidad lo impide.
    const second = service.move(1, DEST_B);
    expect(second).toMatchObject({ decision: 'AUTHORIZED', state: 'IDLE', position: DEST_B });
    expect(service.getState(1)).toEqual({
      state: 'IDLE',
      position: DEST_B,
      positionQuality: 'RELIABLE',
    });
  });

  it('un tercer movimiento válido refuerza la vivacidad: sin BUSY ni SAFE_STOP en la cadena', () => {
    const outcomes = [service.move(1, DEST_A), service.move(1, DEST_B), service.move(1, DEST_C)];

    for (const out of outcomes) {
      expect(out.decision).toBe('AUTHORIZED');
    }

    // Ninguna decisión fue un rechazo por estado (BUSY) ni hubo parada preventiva (SAFE_STOP).
    expect(outcomes.some((out) => out.decision === 'REJECTED')).toBe(false);
    expect(outcomes.some((out) => out.state === 'SAFE_STOP')).toBe(false);

    // Estado final consistente con el último destino y sin atasco.
    expect(service.getState(1)).toEqual({
      state: 'IDLE',
      position: DEST_C,
      positionQuality: 'RELIABLE',
    });
  });

  it('mecanismo puro: completeMove("MOVING") === "IDLE" (DD-209)', () => {
    // Micro-aserción del mecanismo que habilita la vivacidad a nivel de servicio.
    expect(completeMove('MOVING')).toBe('IDLE');
  });
});
