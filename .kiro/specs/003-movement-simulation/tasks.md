# Implementation Plan: Simulación de movimiento (003-movement-simulation)

**Fase MADA:** CONSTRUIR
**HU cubiertas:** HU-03
**Estado:** Tareas 1–24 implementadas; revisión QA RECHAZADA por B-1 — se resuelve con RC-01. Refuerzo RC-01 (rev2): pendiente de inicio (requiere aprobación humana del refuerzo en requirements.md y design.md)

## Overview

Plan de implementación de la HU-03. Orden: dominio → persistencia → regla/servicio/backend →
frontend → pruebas → calidad. La decisión vive en el backend (regla pura `decideMovement`
que reutiliza `isCollision` de la spec 001); la UI solo muestra la respuesta de la API.

## Tasks

- [x] 1. Añadir al dominio `@home-guardian/domain` los tipos `RobotStateName`, `Decision`, `RobotSnapshot`, `MoveRequest`, `MoveResult`
  - _Requisitos: RF-02, RF-03, RNF-02_
- [x] 2. Añadir esquemas Zod `pointSchema` y `moveRequestSchema` y exportarlos desde `index.ts`
  - _Requisitos: RNF-01, RF-01.2_
- [x] 3. Crear migración `create_robot_state.sql` (tabla singleton `robot_state` con estado y posición)
  - _Requisitos: RF-02.1, DD-103_
- [x] 4. Crear migración `create_movement_log.sql` (tabla append-only `movement_log`)
  - _Requisitos: RF-05.1, DD-105_
- [x] 5. Implementar `robotRepository` (leer snapshot, actualizar estado/posición) con SQL parametrizado
  - _Requisitos: RF-02.1, RF-03.1, RF-03.2_
- [x] 6. Implementar `movementLogRepository` (solo inserción de decisiones)
  - _Requisitos: RF-05.1_
- [x] 7. (TDD, prueba roja primero) Implementar la regla pura `decideMovement` reutilizando `isCollision` (spec 001): ALLOW, PREVENTIVE_STOP (destino y trayectoria), DENIED_SAFE_STOP
  - _Requisitos: RF-02.2, RF-03.1, RF-03.2, RF-03.3, RNF-06_
- [x] 8. Implementar `movementService`: validar límites del plano (`DESTINATION_OUT_OF_BOUNDS`), leer zonas activas y robot, invocar `decideMovement`, persistir estado y log
  - _Requisitos: RF-01.4, RF-02.3, RF-05.1, DD-107_
- [x] 9. Implementar `simulationController` mapeando decisión → HTTP (200 ALLOW/PREVENTIVE_STOP, 409 DENIED_SAFE_STOP, 422 fuera de plano/payload)
  - _Requisitos: RF-04, DD-101, DD-102_
- [x] 10. Crear `routes/simulationRoutes.ts` (`GET /robot`, `POST /move`, `POST /reset`) y montar en `app.ts`
  - _Requisitos: Contrato de API_
- [x] 11. Implementar `reset` (SAFE_STOP → IDLE conservando posición) como única salida de SAFE_STOP
  - _Requisitos: DD-106_
- [x] 12. Crear `api/client.ts` + `simulationApi` (getRobot, move, reset)
  - _Requisitos: Convención frontend_
- [x] 13. Crear `hooks/useSimulation.ts` con estados de carga/error por operación
  - _Requisitos: RF-04.5_
- [x] 14. Reutilizar `FloorPlan` para capturar destino por clic (viewport→coords de plano) y pintar la posición del robot
  - _Requisitos: RF-01.1, RF-04.4_
- [x] 15. Crear `components/CoordInput.tsx` (destino por coordenadas) produciendo el mismo `Point` que el clic
  - _Requisitos: RF-01.2, RF-01.3, CA-03.7_
- [x] 16. Crear `components/DecisionPanel.tsx` que muestra decisión/estado/razón sin recalcular reglas (parada preventiva + `zoneName`; `SAFE_STOP_ACTIVE`)
  - _Requisitos: RF-04.1, RF-04.2, RF-04.3, CA-03.6_
- [x] 17. Integrar `pages/SimulationPage.tsx` (plano + entrada + panel) y actualizar posición/estado tras cada solicitud
  - _Requisitos: RF-04.4_
- [x] 18. Dejar placeholder reservado de inyección de fallos de sensor / alerta A-04 / prueba T-18 (sin implementar)
  - _Requisitos: Fuera de alcance (reservado)_
- [x] 19. Pruebas unit de `decideMovement`: ALLOW, PREVENTIVE_STOP (destino en zona), PREVENTIVE_STOP (trayectoria cruza), DENIED desde SAFE_STOP, determinismo
  - _Requisitos: CA-03.1, CA-03.2, CA-03.3, CA-03.4, RNF-06_
- [x] 20. Pruebas unit del servicio: 422 DESTINATION_OUT_OF_BOUNDS, persistencia de estado y de `movement_log`
  - _Requisitos: CA-03.5, RF-05.1_
- [x] 21. Pruebas de integración (Supertest): GET /robot, POST /move 200/409/422, POST /reset, registro en movement_log
  - _Requisitos: Contrato de API, CA-03.1..CA-03.5, CA-03.8_
- [x] 22. Pruebas de componentes (RTL): DecisionPanel no recalcula; destino por clic == por coordenadas
  - _Requisitos: CA-03.6, CA-03.7_
- [x] 23. Prueba E2E (Playwright): clic en zona → parada preventiva visible; reset → IDLE
  - _Requisitos: HU-03, CA-03.2, CA-03.4_
- [ ] 24. Calidad: ESLint + Prettier sin errores, cero `any`, sin secretos, pipeline CI verde
  - _Requisitos: RNF-02, Compuerta de oro_
  - Parcial (2026-11-22): ESLint sin errores, typecheck y build OK, cero `any`, sin secretos;
    archivos de la HU formateados con el estilo del repo (comillas simples, 100 columnas).
    **Pendiente:** el repo no tiene configuración de Prettier (`npm run format:check` falla
    en todo el repo con los valores por defecto) ni workflow de GitHub Actions, así que no
    hay "pipeline CI verde" que mostrar.

## Task Dependency Graph

```mermaid
graph TD
  W0[Dominio: 1-2] --> W1[Persistencia: 3-6]
  W0 --> W2[Regla/Backend: 7-11]
  W1 --> W2
  W0 --> W3[Frontend: 12-18]
  W2 --> W3
  W0 --> W4[Pruebas: 19-23]
  W1 --> W4
  W2 --> W4
  W3 --> W4
  W4 --> W5[Calidad: 24]
```

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3", "4", "5", "6"] },
    { "id": 2, "tasks": ["7", "8", "9", "10", "11"] },
    { "id": 3, "tasks": ["12", "13", "14", "15", "16", "17", "18"] },
    { "id": 4, "tasks": ["19", "20", "21", "22", "23"] },
    { "id": 5, "tasks": ["24"] }
  ]
}
```

## Notes

- TDD obligatorio en `decideMovement` (tarea 7): prueba roja antes de implementar.
- La UI nunca evalúa reglas: solo muestra la respuesta de la API (art. III).
- `movement_log` es append-only (sin UPDATE/DELETE); registro inmutable de decisiones.
- Reservado (no implementar en esta spec): inyección de fallos de sensor, alerta A-04,
  prueba T-18, y estados DEGRADED/RECOVERING.
- Compuerta Fase 3 (CONSTRUIR): todas las tareas completas, cada CA con al menos una prueba,
  revisión del humano antes de pasar a VERIFICAR.

### Trazabilidad CA → tarea
| CA | Tareas |
|----|--------|
| CA-03.1 | 7, 8, 19, 21 |
| CA-03.2 | 7, 16, 19, 21, 23 |
| CA-03.3 | 7, 19, 21 |
| CA-03.4 | 7, 11, 16, 19, 21, 23 |
| CA-03.5 | 8, 20, 21 |
| CA-03.6 | 16, 22 |
| CA-03.7 | 14, 15, 22 |
| CA-03.8 | 6, 8, 21 |

---

## Refuerzo RC-01 rev2 — plan vigente [RC-01 rev2]

Sustituye al plan RC-01 original (conservado abajo como histórico, con prefijo `v1-`). Resuelve
B-1 (ciclos), B-2 (doble migración de la UI), I-1 (dos vigilantes en integraciones intermedias),
I-2 (orden de migraciones) e I-8 (pruebas afectadas por archivo) del informe del analista.

**Reglas del plan**
- **Dos unidades de integración.** Nada intermedio se integra en `integration`/`develop`. Dentro de
  la rama de trabajo cada tarea termina en verde: el código antiguo sigue funcionando hasta su
  tarea de retirada, que va dentro de la misma unidad.
- **U1 — vigilante único + incidentes + robots y sesiones** (prioridad del humano), pasos 1–5:
  1. dominio aditivo; 2. migraciones en orden de entrega; 3. backend probado con apps de prueba
  **sin montar** en `app.ts`; 4. UI contra `/api/robots/:robotId/*` (una sola migración, Q-F);
  5. montaje en `app.ts` + retirada del vigilante provisional + prueba de arquitectura + E2E.
- **U2 — supervisión completa y zonas:** indicadores, "Enviar a escaleras", panel de telemetría,
  y lo de la spec 001 (registro de cambios de zona `013`, tarjeta de reglas), calidad.
- **TDD:** toda tarea "(Prueba roja primero)" se ejecuta y se ve fallar con evidencia real
  (art. XV) antes de su implementación.
- **Sin dependencias hacia delante:** cada tarea solo requiere tareas de un paso igual o anterior,
  de esta spec o de las otras. Dependencias externas por paso:
  - [001·U1-1] `RULES` y `ruleForDecision` (spec 001, única definición).
  - [002·U1-2] migraciones `008_robot_state_per_robot`, `009_incidents_robot_rule_zone`,
    `010_create_state_transition_log` (con fila base `MIGRATION_BASELINE`), `011_audit_log_generalize`
    y el endurecimiento de `migrate.ts` (spec 002).
  - [002·U1-3] `guardianService` por robot: `initRobot` (`INSERT` simple), `move` que invoca
    `acceptRequest` y audita sus rechazos, `recover` con `transitioned`/`cause`, `position` con
    `POSITION_CONFLICT` y pérdida → `DEGRADED` + incidente `R-SIGNAL-01`, incidentes con
    `robot_id`/`rule`/`zone_name` y `GET /api/incidents(/:id)` (spec 002).
  - [002·U1-5] montaje de las rutas por robot y retirada de `/api/robot/*` singular, de
    `RobotSnapshot`, de `get`/`save` del `robotRepository` y del alias `moveSchema` (spec 002, I-9).

### U1 · paso 1 — Dominio (aditivo, build en verde)

- [ ] RC-1. [U1·1] (Prueba roja primero) Pruebas de dominio de `robotInputSchema` (nombre 1–60 tras `trim`, solo espacios, tipo inválido, campos extra → inválido) y `moveCommandSchema` (`sessionId` UUID, `sequence` entero ≥ 1, `destination` punto)
  - _Requisitos: RF-07.2, RF-08.2, RNF-01_
  - _Pruebas: nuevas `domain/tests/robotCatalogSchema.test.ts` y `domain/tests/moveCommandSchema.test.ts`_
- [ ] RC-2. [U1·1] Añadir al dominio `RobotType`, `Robot` (con `state: RobotStateName` y `lastRequest: LastRequest | null`), `RobotInput`, `MoveCommand`, `SessionInfo`, `LastRequest`, `robotInputSchema` y `moveCommandSchema`; exportar desde `index.ts` sin tocar los tipos de la 003 que aún usa la UI
  - _Requisitos: RF-07, RF-08, RF-08.9, RNF-02, DD-122_ — requiere [001·U1-1] solo para los tipos de `rule` que muestra la UI

### U1 · paso 2 — Migraciones en orden de entrega

- [ ] RC-3. [U1·2] (Prueba roja primero) Pruebas de `007_create_robots.sql` y `012_create_robot_sessions.sql`: CHECK de nombre y tipo, `UNIQUE(name)`, semilla A1 (id 1) y V2 (id 2), esquema único de `robot_sessions` (`session_id UNIQUE`, `last_sequence NOT NULL DEFAULT 0`, FK a `robots`); con la `008` de la 002: base nueva → A1 en (160, 123) y V2 en (488, 290); base existente → A1 conserva la fila anterior (Q-E)
  - _Requisitos: RF-07.3, RF-07.5, RF-07.6, RF-08.5, CA-03.19, DD-119, DD-122_
  - _Pruebas: modifica `backend/tests/unit/migrate.test.ts` (lista de tablas y versiones aplicadas); nueva `backend/tests/unit/robotCatalogMigrations.test.ts`_
- [ ] RC-4. [U1·2] Crear `007_create_robots.sql` (primera migración de U1) y `012_create_robot_sessions.sql` (tras las `008`–`011` de la 002); `robotCatalogRepository` y `sessionRepository` con SQL parametrizado; fechas con `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  - _Requisitos: RF-07.5, RF-07.6, RF-08.5, DD-110, DD-111, DD-122_ — requiere [002·U1-2] para que `012` se aplique después de `011`

### U1 · paso 3 — Backend sin montar en `app.ts`

- [ ] RC-5. [U1·3] (Prueba roja primero) Pruebas unitarias de `checkSequence`: sesión vigente, ajena o inexistente; `lastSequence = 0`; secuencia mayor, igual y menor
  - _Requisitos: RF-08.3, RF-08.4, Property 7, CA-03.11, CA-03.12_
  - _Pruebas: nueva `backend/tests/unit/sequenceRule.test.ts`_
- [ ] RC-6. [U1·3] Implementar `rules/sequenceRule.ts` (`checkSequence`, pura)
  - _Requisitos: RF-08.3, RF-08.4, DD-112_
- [ ] RC-7. [U1·3] (Prueba roja primero) Pruebas de `sessionService`: `startSession` invalida la anterior y deja `last_sequence = 0`; `acceptRequest` devuelve `{ kind: 'accepted' }` o `{ kind: 'rejected', code }` **sin lanzar** (B-5); la última solicitud aceptada se persiste y se expone como `LastRequest`
  - _Requisitos: RF-08.1, RF-08.4, RF-08.5, RF-08.8, RF-08.9, DD-117_
  - _Pruebas: nueva `backend/tests/unit/sessionService.test.ts`_
- [ ] RC-8. [U1·3] Implementar `services/sessionService.ts` (`startSession`, `acceptRequest`)
  - _Requisitos: RF-08.1, RF-08.5, DD-117_
- [ ] RC-9. [U1·3] (Prueba roja primero) Pruebas de `robotCatalogService.register`: estado inicial creado por `guardianService.initRobot` en la misma transacción; con la zona "Sala" activa → `{ kind: 'rejected', code: 'ROBOT_START_IN_RESTRICTED_ZONE' }`, fila en `audit_log` leída **después** de confirmar y sin filas nuevas en `robots`/`robot_state`; nombre repetido → `409 ROBOT_NAME_DUPLICATE`; si `initRobot` falla, no queda fila en `robots`
  - _Requisitos: RF-07.1, RF-07.3, RF-07.4, RF-07.9, Property 8, Property 11, CA-03.9, CA-03.22, DD-118_
  - _Pruebas: nueva `backend/tests/unit/robotCatalogService.test.ts`_
- [ ] RC-10. [U1·3] Implementar `robotCatalogService` (transacción `IMMEDIATE`: validación Q-D con la geometría de la 001, fila de `robots`, `initRobot`), `robotsController` y `routes/robotsRoutes.ts` (`GET/POST /api/robots`, `GET /api/robots/:robotId`, `POST /api/robots/:robotId/sessions`); probados con una app de prueba que monta solo estas rutas
  - _Requisitos: RF-07, RF-08.1, DD-110, DD-117, DD-118_ — requiere [002·U1-3] (`initRobot`)
- [ ] RC-11. [U1·3] (Prueba roja primero) Integración Supertest sobre una app de prueba con las rutas de esta spec y las por robot de la 002 (sin `app.ts`): `GET/POST /api/robots` (201/422/409/404), `ROBOT_START_IN_RESTRICTED_ZONE`, `POST .../sessions`, `move` con `INVALID_SESSION`, `DUPLICATE_EVENT` e `INVALID_MOVE_REQUEST`; tras **cada** `409` se lee `audit_log` (Property 11); `lastRequest` en `GET .../state`
  - _Requisitos: RF-06.1, RF-07, RF-08.3, RF-08.4, RF-08.8, RF-08.9, CA-03.9..CA-03.12, CA-03.20, CA-03.22, CA-03.25_ — requiere [002·U1-3]
  - _Pruebas: nueva `backend/tests/integration/robots.api.test.ts`_

### U1 · paso 4 — UI contra `/api/robots/:robotId/*` (una sola migración, Q-F)

- [ ] RC-12. [U1·4] (Prueba roja primero) Pruebas RTL de `DecisionPanel` con el vocabulario de la 002: `AUTHORIZED`, `DENIED` (code, zona, `incidentId`), `REJECTED` con `SAFE_STOP_ACTIVE` y con `BUSY`, sin código inventado
  - _Requisitos: RF-04.1, RF-04.2, RF-04.3, CA-03.2, CA-03.4, CA-03.6_
  - _Pruebas: reescribe `frontend/tests/components/DecisionPanel.test.tsx`_
- [ ] RC-13. [U1·4] (Prueba roja primero) Pruebas RTL de `robotsApi` y `useRobot(robotId)`: estado con `lastRequest`; `move` con `sessionId` y `sequence` automáticos (1, 2, 3); `recover` con `transitioned` true/false y `409 RECOVERY_NOT_ALLOWED` con `cause`; `409` de rechazo mostrados tal cual; "Perder conexión" envía `MISSING`; "Recuperar señal" envía `RELIABLE` con la posición del último estado y muestra `POSITION_CONFLICT` si llega
  - _Requisitos: RF-04.5, RF-08.6, RF-10.6, RF-10.7, RF-11.2, RF-11.3, CA-03.13, CA-03.14, CA-03.23, CA-03.31, CA-03.32_
  - _Pruebas: nueva `frontend/tests/components/useRobot.test.tsx`; sustituye a `useSimulation.test.tsx` (se retira en RC-23)_
- [ ] RC-14. [U1·4] Implementar `robotsApi` e `incidentsApi` en `api/client.ts` y los hooks `useRobot` y `useRobots` contra `/api/robots/:robotId/*` (sin etapa `/api/robot`)
  - _Requisitos: RF-11.1, RF-04.4, RF-04.5, RF-08.6, DD-116_ — requiere [002·U1-3]
- [ ] RC-15. [U1·4] Adaptar `DecisionPanel` y `SimulationPage`: vocabulario de la 002, "Liberar parada" → `recover` con mensajes según `transitioned`/`cause`, botones "⌁ Perder conexión" y "↻ Recuperar señal", 5 estados y `positionQuality` con los colores del prototipo, selector de robot y `FloorPlan` con N robots
  - _Requisitos: RF-04.2, RF-04.3, RF-04.6, RF-10.2, RF-10.5..RF-10.7, RF-11.2, RF-11.3, CA-03.13, CA-03.14, CA-03.16, CA-03.30..CA-03.32, DD-120_
  - _Pruebas: reescribe `frontend/tests/components/SimulationPage.test.tsx` y `FloorPlan.test.tsx` (N robots, colores por estado y tipo)_
- [ ] RC-16. [U1·4] (Prueba roja primero) Pruebas RTL de `IncidentsPage`: tabla Fecha · Robot · Regla · Zona · Decisión, contador "N eventos", detalle con snapshot, estado vacío ("0 eventos"), incidente `R-SIGNAL-01` con zona "—", botones HU-06/HU-07 deshabilitados
  - _Requisitos: RF-09.1..RF-09.6, CA-03.15, CA-03.26, CA-03.27_
  - _Pruebas: nueva `frontend/tests/components/IncidentsPage.test.tsx`_
- [ ] RC-17. [U1·4] Implementar `useIncidents`, `IncidentsPage`, `IncidentTable` e `IncidentDetail` (solo lectura)
  - _Requisitos: RF-09.1..RF-09.6_ — requiere [002·U1-3], [001·U1-1]
- [ ] RC-18. [U1·4] (Prueba roja primero) Pruebas RTL de `RobotsPage`, `RobotCard` y `RegisterRobotModal` (errores `422 INVALID_ROBOT`, `409 ROBOT_NAME_DUPLICATE` y `409 ROBOT_START_IN_RESTRICTED_ZONE` visibles) y de la barra lateral con las 4 vistas
  - _Requisitos: RF-07.8, RF-10.1, CA-03.10, CA-03.21, CA-03.22, CA-03.28_
  - _Pruebas: nuevas `frontend/tests/components/RobotsPage.test.tsx`; reescribe `frontend/tests/components/App.test.tsx`_
- [ ] RC-19. [U1·4] Implementar `RobotsPage`, `RobotCard`, `RegisterRobotModal` y `App.tsx` (barra lateral: Supervisión, Robots simulados, Zonas y reglas, Incidentes; rutas hash)
  - _Requisitos: RF-07.8, RF-10.1_

### U1 · paso 5 — Montaje, retirada y E2E (misma entrega)

- [ ] RC-20. [U1·5] (Prueba roja primero, **antes** de RC-21) Pruebas que hoy fallan: `/api/simulation/*` → `404`; prueba de arquitectura: solo `guardianService`, `db/bootstrap` y las migraciones escriben `robot_state` (con la 002); escaneo estático: la UI no importa reglas de dominio. Se ejecutan y se ven fallar mientras el vigilante provisional sigue montado
  - _Requisitos: RF-11.1, RF-11.4, RF-02.3, CA-03.17, Property 9, Property 10_
  - _Pruebas: nueva `backend/tests/integration/singleGuardian.test.ts` (o ampliación de la de arquitectura de la 002); el escaneo estático ya existe en `DecisionPanel.test.tsx` y se mantiene_
- [ ] RC-21. [U1·5] Montar `robotsRoutes` en `app.ts` junto con las rutas por robot de la 002 y **retirar en el mismo cambio**: `rules/watchmanRule.ts`, `services/movementService.ts`, `controllers/simulationController.ts`, `routes/simulationRoutes.ts` y su montaje, `simulationApi`, `useSimulation`, los tipos `Decision`/`MoveResult`, y (coordinado con [002·U1-5]) `RobotSnapshot`, `moveRequestSchema`/`simulation.schema.ts` y el alias `moveSchema`; `movement_log` se conserva como histórico
  - _Requisitos: RF-11.1, RF-11.4, DD-108, DD-109, CA-03.8, CA-03.17_ — requiere [002·U1-5]
  - _Pruebas: se retiran `backend/tests/unit/watchmanRule.test.ts`, `backend/tests/unit/movementService.test.ts`, `backend/tests/integration/simulation.api.test.ts` y `frontend/tests/components/useSimulation.test.tsx`; se modifica `domain/tests/simulationSchema.test.ts` (solo `pointSchema`) y `domain/tests/robotSchema.test.ts` si usaba el alias; RC-20 pasa a verde_
- [ ] RC-22. [U1·5] E2E (reescribe `frontend/tests/e2e/simulation.spec.ts`): clic en zona → `DENIED` con incidente visible en "Incidentes"; nuevo movimiento → `REJECTED SAFE_STOP_ACTIVE`; "Liberar parada" → `IDLE` con "Parada liberada"; robot dentro de una zona activa → recover rechazado con `UNSAFE_POSITION`; desactivar la zona → recover OK; "Perder conexión" → `DEGRADED` + incidente `R-SIGNAL-01`; "Recuperar señal" + "Liberar parada" → `IDLE`; registrar robot → aparece en (120, 90) en `IDLE` y sigue tras recargar la página; con "Sala" activa → `409 ROBOT_START_IN_RESTRICTED_ZONE`; reenviar la misma `sequence` (vía API) → `DUPLICATE_EVENT` sin incidente nuevo. Base `:memory:` nueva por ejecución y en serie
  - _Requisitos: CA-03.1, CA-03.2, CA-03.4, CA-03.9, CA-03.11, CA-03.13..CA-03.15, CA-03.18, CA-03.22, CA-03.31, CA-03.32_

### U2 — Supervisión completa (más la parte de la spec 001)

- [ ] RC-23. [U2] (Prueba roja primero) Pruebas RTL: indicadores (robots activos, paradas, "Solicitudes procesadas" = `lastRequest.sequence`, zonas restringidas), "⚠ Enviar a escaleras" con la zona activa e inactiva, `TelemetryPanel` con el JSON tal cual
  - _Requisitos: RF-08.7, RF-10.3, RF-10.4, CA-03.24, CA-03.29, DD-114, DD-115, DD-121_
  - _Pruebas: amplía `frontend/tests/components/SimulationPage.test.tsx`; nueva `frontend/tests/components/TelemetryPanel.test.tsx`_
- [ ] RC-24. [U2] Implementar indicadores, "Enviar a escaleras" y `TelemetryPanel` en `SimulationPage`
  - _Requisitos: RF-08.7, RF-10.3, RF-10.4_
- [ ] RC-25. [U2] E2E: los dos robots de la semilla visibles; seleccionar `Vigilante V2` y enviarlo a escaleras → `DENIED` solo para ese robot, el otro sigue en `IDLE`; el indicador "Solicitudes procesadas" sube con cada envío
  - _Requisitos: CA-03.16, CA-03.2, CA-03.29_
- [ ] RC-26. [U2] Calidad: lint, typecheck, build y todas las pruebas (unit, integración, RTL, E2E) en verde con evidencia real; cero `any`; sin secretos
  - _Requisitos: RNF-02, Compuerta de oro_
- [ ] RC-27. [U2] Tras la aprobación humana: actualizar el estado de requirements/design y cerrar el hallazgo B-1 en la revisión QA
  - _Requisitos: art. XII, art. XV_

### Dependencias RC-01 rev2

```mermaid
graph TD
  R1[001·U1-1 RULES] --> P1[U1·1 RC-1..RC-2]
  P1 --> P2a[U1·2 RC-3..RC-4: 007]
  P2a --> M002[002·U1-2: 008-011 + migrate.ts]
  M002 --> P2b[U1·2 RC-4: 012]
  P2b --> P3[U1·3 RC-5..RC-11]
  G002[002·U1-3 guardianService por robot] --> P3
  P3 --> P4[U1·4 RC-12..RC-19]
  P4 --> P5[U1·5 RC-20..RC-22]
  R002[002·U1-5 montaje y retirada] --> P5
  P5 --> U2[U2 RC-23..RC-27]
```

```json
{
  "units": [
    { "id": "U1", "steps": {
      "1": ["RC-1", "RC-2"],
      "2": ["RC-3", "RC-4"],
      "3": ["RC-5", "RC-6", "RC-7", "RC-8", "RC-9", "RC-10", "RC-11"],
      "4": ["RC-12", "RC-13", "RC-14", "RC-15", "RC-16", "RC-17", "RC-18", "RC-19"],
      "5": ["RC-20", "RC-21", "RC-22"] },
      "integrates": "completa o no se integra" },
    { "id": "U2", "tasks": ["RC-23", "RC-24", "RC-25", "RC-26", "RC-27"] }
  ]
}
```

### Trazabilidad CA → tareas [RC-01 rev2]
| CA | Tareas |
|----|--------|
| CA-03.1 | RC-14, RC-22 |
| CA-03.2 | RC-12, RC-15, RC-22, RC-25 |
| CA-03.3 | RC-12 (la decisión la prueba la spec 002) |
| CA-03.4 | RC-12, RC-15, RC-22 |
| CA-03.5 | RC-14 (la validación la prueba la spec 002; la UI conserva `CoordInput`) |
| CA-03.6 | RC-12, RC-20 |
| CA-03.7 | RC-13, RC-15 |
| CA-03.8 | RC-21 |
| CA-03.9 | RC-9, RC-11, RC-22 |
| CA-03.10 | RC-1, RC-11, RC-18 |
| CA-03.11 | RC-5, RC-11, RC-22 |
| CA-03.12 | RC-5, RC-7, RC-11 |
| CA-03.13 | RC-13, RC-15, RC-22 |
| CA-03.14 | RC-13, RC-15, RC-22 |
| CA-03.15 | RC-16, RC-17, RC-22 |
| CA-03.16 | RC-15, RC-25 |
| CA-03.17 | RC-20, RC-21 |
| CA-03.18 | RC-22 (recarga tras registrar) |
| CA-03.19 | RC-3 |
| CA-03.20 | RC-11 |
| CA-03.21 | RC-18 |
| CA-03.22 | RC-9, RC-11, RC-18, RC-22 |
| CA-03.23 | RC-13 |
| CA-03.24 | RC-23 |
| CA-03.25 | RC-7, RC-11 |
| CA-03.26 | RC-16 |
| CA-03.27 | RC-16 |
| CA-03.28 | RC-18 |
| CA-03.29 | RC-23, RC-25 |
| CA-03.30 | RC-15 |
| CA-03.31 | RC-13, RC-15, RC-22 |
| CA-03.32 | RC-13, RC-15, RC-22 |

---

## Refuerzo RC-01 — tareas de convergencia (Sustituido por RC-01 rev2 — histórico)


Convergencia con las 5 HU del prototipo (requirements §1 [RC-01], design DD-108..DD-115). Reglas
del plan:
- **TDD:** cada bloque empieza con sus pruebas en rojo (ejecutadas y vistas fallar, con evidencia
  real, art. XV) antes de implementar.
- **Nunca dos vigilantes integrados:** el bloque A se integra completo (UI migrada + retirada de
  `/api/simulation/*`) o no se integra.
- **Dependencias externas** (se citan por nombre porque las specs 001 y 002 numeran por su cuenta):
  - [002-multi-robot] contrato multi-robot del vigilante de la spec 002:
    `/api/robots/:robotId/state|move|recover|position`, `robot_state` con una fila por robot.
  - [002-recover] `recover` con `transitioned` y `409 RECOVERY_NOT_ALLOWED` + `cause` (spec 002).
  - [002-incidents] incidentes con `robot_id` y `rule` y `GET /api/incidents(/:id)` (spec 002).
  - [002-transitions] `state_transition_log` (spec 002).
  - [002-move-session] el `move` de la 002 invoca `acceptRequest` antes del vigilante (spec 002).
  - [001-rules] catálogo `RULES` en el dominio (spec 001).
- Orden: **A** (refuerzo 1 + vista de incidentes) → **B** (robots y sesiones) → **C** (UI
  general del prototipo) → **D** (calidad).

### Bloque A — Un solo vigilante en la UI y vista de incidentes (prioridad)

- (histórico) v1-RC-1. (Prueba roja primero) Pruebas RTL de `DecisionPanel` con el vocabulario de la 002: `AUTHORIZED`, `DENIED` (code, zona, `incidentId`), `REJECTED` con `SAFE_STOP_ACTIVE` y con `BUSY`, sin código inventado cuando falta
  - _Requisitos: RF-04.1, RF-04.2, RF-04.3, CA-03.2, CA-03.4, CA-03.6_
- (histórico) v1-RC-2. (Prueba roja primero) Pruebas RTL de `useRobot` y del cliente `robotsApi`: estado, move, recover (`transitioned` true/false, `409 RECOVERY_NOT_ALLOWED` con `cause`); un `409 REJECTED` se devuelve como decisión
  - _Requisitos: RF-11.2, RF-11.3, RF-04.5, CA-03.13, CA-03.14_
- (histórico) v1-RC-3. Implementar `robotsApi` en `api/client.ts` y el hook `useRobot(robotId)` (sustituyen a `simulationApi`/`useSimulation`) contra las rutas por robot
  - _Requisitos: RF-11.1, RF-04.4, RF-04.5_ — requiere [002-multi-robot], [002-recover]
- (histórico) v1-RC-4. Adaptar `DecisionPanel` y `SimulationPage` al vocabulario de la 002; botón "Liberar parada" → `recover` con mensajes según `transitioned`/`cause`; mostrar los 5 estados y `positionQuality` con los colores del prototipo
  - _Requisitos: RF-04.2, RF-04.3, RF-04.6, RF-11.2, RF-11.3, CA-03.13, CA-03.14_
- (histórico) v1-RC-5. (Prueba roja primero) Pruebas RTL de `IncidentsPage`: tabla Fecha · Robot · Regla · Zona · Decisión, contador "N eventos", detalle con snapshot, estado vacío, botones HU-06/HU-07 deshabilitados
  - _Requisitos: RF-09.1..RF-09.5, CA-03.15_
- (histórico) v1-RC-6. Implementar `incidentsApi`, `useIncidents`, `IncidentsPage`, `IncidentTable` e `IncidentDetail` (solo lectura)
  - _Requisitos: RF-09.1..RF-09.5_ — requiere [002-incidents], [001-rules]
- (histórico) v1-RC-7. (Prueba roja primero) Prueba de integración: `/api/simulation/*` → 404; escaneo estático: la UI no importa reglas de dominio
  - _Requisitos: RF-11.1, RF-11.4, RF-02.3, CA-03.17, Property 9, Property 10_
- (histórico) v1-RC-8. Retirar `rules/watchmanRule.ts`, `services/movementService.ts`, `controllers/simulationController.ts`, `routes/simulationRoutes.ts`, su montaje en `app.ts`, `simulationApi`, `useSimulation`, los tipos `Decision`/`MoveResult` y sus pruebas (`watchmanRule.test.ts`, `movementService.test.ts`, `simulation.api.test.ts` y las RTL que dependan de ellos); `movement_log` se conserva como histórico
  - _Requisitos: RF-11.1, RF-11.4, DD-108, DD-109, CA-03.8_ — requiere [002-transitions]; misma entrega que RC-3..RC-6
- (histórico) v1-RC-9. E2E (actualizar `simulation.spec.ts`): clic en zona → `DENIED` con incidente visible en "Incidentes"; nuevo movimiento → `REJECTED SAFE_STOP_ACTIVE`; "Liberar parada" → `IDLE` con "Parada liberada"; robot dentro de una zona activa → recover rechazado con `UNSAFE_POSITION`; desactivar la zona → recover OK
  - _Requisitos: CA-03.1, CA-03.2, CA-03.4, CA-03.13, CA-03.14, CA-03.15_

### Bloque B — Catálogo de robots y sesiones

- (histórico) v1-RC-10. (Prueba roja primero) Pruebas de `robotInputSchema` y `moveCommandSchema` en el dominio (nombre 1–60 tras trim, solo espacios, tipo inválido, campos extra → inválido; `sessionId` UUID; `sequence` entero ≥ 1)
  - _Requisitos: RF-07.2, RF-08.2, RNF-01_
- (histórico) v1-RC-11. Añadir al dominio `RobotType`, `Robot`, `RobotInput`, `MoveCommand`, `SessionInfo`, `LastAcceptedRequest`, `robotInputSchema` y `moveCommandSchema` (aditivo, sin romper el build)
  - _Requisitos: RF-07, RF-08, RNF-02_
- (histórico) v1-RC-12. (Prueba roja primero) Pruebas unitarias de `checkSequence`: sesión vigente/ajena/nula, secuencia mayor/igual/menor, primera solicitud
  - _Requisitos: RF-08.3, RF-08.4, Property 7, CA-03.11, CA-03.12_
- (histórico) v1-RC-13. Implementar `rules/sequenceRule.ts` (`checkSequence`, pura)
  - _Requisitos: RF-08.3, RF-08.4, DD-112_
- (histórico) v1-RC-14. (Prueba roja primero) Pruebas de migraciones y repositorios: tabla `robots` (CHECK de nombre y tipo, UNIQUE), seed de los 2 robots del prototipo, `robot_sessions`
  - _Requisitos: RF-07.3, RF-07.5, RF-07.6, RF-08.5_
- (histórico) v1-RC-15. Migraciones `007_create_robots.sql` (con seed de los 2 robots; la asociación de la fila actual de `robot_state` a `Aspiradora A1` la hace la migración 008 de la spec 002) y `012_create_robot_sessions.sql`; `robotCatalogRepository` y `sessionRepository` (SQL parametrizado). La numeración se asigna según el orden del plan conjunto con la 002
  - _Requisitos: RF-07.5, RF-07.6, RF-08.5, DD-110, DD-111_ — coordinar con [002-multi-robot]
- (histórico) v1-RC-16. (Prueba roja primero) Pruebas de `robotCatalogService` y `sessionService`: estado inicial asignado por el backend, duplicado → 409, inexistente → 404, nueva sesión invalida la anterior, última solicitud persistida
  - _Requisitos: RF-07.1..RF-07.7, RF-08.1, RF-08.5, Property 8, CA-03.9, CA-03.10, CA-03.12_
- (histórico) v1-RC-17. Implementar `robotCatalogService` (crea `robots` e invoca `guardianService.initRobot` de la 002 en la misma transacción; el catálogo no escribe `robot_state`) y `sessionService` (`newSession`, `acceptRequest`)
  - _Requisitos: RF-07.1, RF-07.4, RF-08.1, RF-08.5_ — requiere [002-multi-robot]
- (histórico) v1-RC-18. (Prueba roja primero) Integración Supertest: `GET/POST /api/robots`, `GET /api/robots/:robotId` (201/422/409/404), `POST /api/robots/:robotId/sessions`, `move` con `INVALID_SESSION` y `DUPLICATE_EVENT` (sin incidente, auditado)
  - _Requisitos: RF-07, RF-08.3, RF-08.4, CA-03.9..CA-03.12_ — requiere [002-move-session]
- (histórico) v1-RC-19. Implementar `robotsController`, `routes/robotsRoutes.ts` (monta también las subrutas por robot de la 002) y el montaje en `app.ts`
  - _Requisitos: RF-07, RF-08.1_
- (histórico) v1-RC-20. (Prueba roja primero) Pruebas RTL de `RobotsPage`, `RobotCard`, `RegisterRobotModal` (errores 422/409 visibles) y `TelemetryPanel` (JSON tal cual)
  - _Requisitos: RF-07.8, RF-08.7, CA-03.9, CA-03.10_
- (histórico) v1-RC-21. Implementar `useRobots`, `RobotsPage`, `RobotCard`, `RegisterRobotModal`, `TelemetryPanel`; `useRobot` lleva `sessionId` y `sequence` automáticos; botón "↻ Nueva sesión"
  - _Requisitos: RF-07.8, RF-08.1, RF-08.6, RF-08.7, DD-113_
- (histórico) v1-RC-22. E2E: registrar robot → aparece en la lista y en el plano en (120, 90) en `IDLE`; reenviar una solicitud con la misma `sequence` → `DUPLICATE_EVENT` visible y sin incidente nuevo
  - _Requisitos: CA-03.9, CA-03.11_

### Bloque C — Supervisión multi-robot y navegación del prototipo

- (histórico) v1-RC-23. (Prueba roja primero) Pruebas RTL: barra lateral con las 4 vistas; `FloorPlan` con N robots y colores por estado/tipo; selector de robot que determina a quién aplican clic, coordenadas, "Enviar a escaleras" y "Liberar parada"; indicadores derivados de la API; "Enviar a escaleras" con zona activa e inactiva
  - _Requisitos: RF-10.1..RF-10.5, CA-03.7, CA-03.16_
- (histórico) v1-RC-24. Implementar `App.tsx` (barra lateral y rutas hash), `SimulationPage` multi-robot (selector, indicadores, "Enviar a escaleras") y `FloorPlan` con N robots
  - _Requisitos: RF-10.1..RF-10.5, DD-114, DD-115_
- (histórico) v1-RC-25. E2E: los dos robots del seed visibles; seleccionar `Vigilante V2` y enviarlo a escaleras → `DENIED` solo para ese robot; el otro sigue en `IDLE`
  - _Requisitos: CA-03.16, CA-03.2_

### Bloque D — Calidad y documentación

- (histórico) v1-RC-26. Calidad: lint, typecheck, build y todas las pruebas (unit, integración, RTL, E2E) en verde con evidencia real; cero `any`; sin secretos
  - _Requisitos: RNF-02, Compuerta de oro_
- (histórico) v1-RC-27. Tras la aprobación humana: actualizar el estado de requirements/design y cerrar el hallazgo B-1 en la revisión QA
  - _Requisitos: art. XII, art. XV_

### Dependencias RC-01 (histórico)

```mermaid
graph TD
  E1[002-multi-robot / 002-recover / 002-transitions] --> A[Bloque A: RC-1..RC-9]
  E2[002-incidents / 001-rules] --> A
  A --> B[Bloque B: RC-10..RC-22]
  E3[002-move-session] --> B
  B --> C[Bloque C: RC-23..RC-25]
  C --> D[Bloque D: RC-26..RC-27]
```

### Trazabilidad CA [RC-01] → tareas (histórico)
| CA | Tareas |
|----|--------|
| CA-03.1 | RC-3, RC-9 |
| CA-03.2 | RC-1, RC-4, RC-9, RC-25 |
| CA-03.3 | RC-1 (la decisión la prueba la spec 002) |
| CA-03.4 | RC-1, RC-4, RC-9 |
| CA-03.5 | RC-3 (la validación la prueba la spec 002; la UI conserva `CoordInput`) |
| CA-03.6 | RC-1, RC-7 |
| CA-03.7 | RC-23 |
| CA-03.8 | RC-8 |
| CA-03.9 | RC-16, RC-18, RC-20, RC-22 |
| CA-03.10 | RC-16, RC-18, RC-20 |
| CA-03.11 | RC-12, RC-18, RC-22 |
| CA-03.12 | RC-12, RC-16, RC-18 |
| CA-03.13 | RC-2, RC-4, RC-9 |
| CA-03.14 | RC-2, RC-4, RC-9 |
| CA-03.15 | RC-5, RC-6, RC-9 |
| CA-03.16 | RC-23, RC-24, RC-25 |
| CA-03.17 | RC-7, RC-8 |
