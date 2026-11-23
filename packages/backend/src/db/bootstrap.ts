import { createRobotRepository } from '../repositories/robotRepository.js';
import type { Db } from './connection.js';

/**
 * Reinicio seguro del robot (ADR-10, spec 002 §5.2 / §6, R6.1–R6.4).
 *
 * Se invoca una sola vez al arrancar el servicio, después de aplicar migraciones y seed.
 * Realiza **a lo sumo una** corrección sobre la fila única `robot_state`:
 *
 * - **R6.3:** si el estado persistido es `MOVING`, lo degrada a `SAFE_STOP` para no reanudar
 *   un movimiento a ciegas tras un reinicio. Conserva la posición y la `positionQuality`.
 * - En cualquier otro estado no toca nada.
 *
 * **Por qué NO fuerza `MISSING` (R6.1, R6.4, lección PD-09):** el seed deja el robot con
 * `positionQuality = 'RELIABLE'` y estado `IDLE`, de modo que la demo pueda moverlo desde el
 * primer uso. Un reinicio del servicio **no** es una señal de pérdida de posición; por eso
 * `bootstrap` preserva la calidad vigente y jamás la pone en `MISSING`/`UNRELIABLE`.
 * `positionQuality` solo cambia a `MISSING`/`UNRELIABLE` ante una señal de pérdida explícita
 * (`POST /api/robot/position`), que no es responsabilidad de esta función. En una iteración
 * previa (PD-09) poner `MISSING` al arrancar dejaba el robot bloqueado sin salida.
 *
 * Es **idempotente**: tras degradar `MOVING → SAFE_STOP`, ejecutarla de nuevo no produce más
 * cambios (ya no hay un `MOVING` persistido).
 */
export function bootstrap(db: Db): void {
  const robots = createRobotRepository(db);
  const snapshot = robots.getFull();
  if (snapshot.state === 'MOVING') {
    // R6.3: única mutación del reinicio seguro. Conserva posición y positionQuality.
    robots.saveFull({ ...snapshot, state: 'SAFE_STOP' });
  }
}
