import { createRobotRepository } from '../repositories/robotRepository.js';
import { createTransitionLogRepository } from '../repositories/transitionLogRepository.js';
import { createTransition } from '../services/transition.js';
import type { Db } from './connection.js';

/**
 * Reinicio seguro de los robots (ADR-10, spec 002 §6, R6.1–R6.5).
 *
 * Se invoca una sola vez al arrancar el servicio, después de aplicar migraciones y seed.
 * Recorre **todos** los robots y, como máximo, aplica una corrección a cada uno:
 *
 * - **R6.3/R6.5:** si el estado persistido es `MOVING`, lo degrada a `SAFE_STOP` (T8, causa
 *   `BOOTSTRAP_MOVING_PERSISTED`) para no reanudar un movimiento a ciegas tras un reinicio.
 *   Conserva la posición y la `positionQuality`.
 * - En cualquier otro estado no toca nada.
 *
 * **Por qué NO fuerza `MISSING` (R6.1, R6.4, lección PD-09):** el seed deja los robots con
 * `positionQuality = 'RELIABLE'` y estado `IDLE`, de modo que la demo pueda moverlos desde el
 * primer uso. Un reinicio del servicio **no** es una señal de pérdida de posición; por eso
 * `bootstrap` preserva la calidad vigente y jamás la pone en `MISSING`/`UNRELIABLE`.
 *
 * Es **idempotente**: tras degradar `MOVING -> SAFE_STOP`, ejecutarla de nuevo no produce más
 * cambios ni filas en el registro de transiciones. Todo ocurre en una sola transacción.
 */
export function bootstrap(db: Db): void {
  const robots = createRobotRepository(db);
  const transition = createTransition({ robots, transitions: createTransitionLogRepository(db) });
  db.transaction(() => {
    for (const { robotId, state, position, positionQuality } of robots.findAll()) {
      if (state !== 'MOVING') continue;
      // R6.3: única mutación del reinicio seguro. Conserva posición y positionQuality.
      transition({
        robotId,
        from: 'MOVING',
        to: 'SAFE_STOP',
        cause: 'BOOTSTRAP_MOVING_PERSISTED',
        position,
        positionQuality,
      });
    }
  })();
}
