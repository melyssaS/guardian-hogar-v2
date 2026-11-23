# Design Document

**Spec:** `002-safety-guardian`
**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-04, HU-05
**Estado:** Borrador — implementado (773823a); refuerzo RC-01 pendiente de aprobación humana

## Overview

Diseño técnico del vigilante de seguridad (HU-04, HU-05). El núcleo es una **regla pura**
`evaluateMovement` que decide con un **orden estricto** (estado → calidad de datos → fallo de
repositorio → geometría → autorización) y una **máquina de estados** con transiciones
prohibidas. La geometría se delega a `isCollision`/`CollisionType` de la spec 001 (sin
recálculo). Toda denegación conduce a parada preventiva y crea un **incidente inmutable**; la
recuperación es explícita y validada. El reinicio seguro (ADR-10) degrada un `MOVING`
persistido a `SAFE_STOP` y arranca con `positionQuality = MISSING`. La prueba **T-12** (28
escenarios) ejercita la decisión con dobles de repositorio, sin frontend ni BD real.

> *Sustituido por RC-01 (corrección):* el arranque **no** pone `MISSING`; conserva la calidad
> persistida (`RELIABLE` tras el seed), como ya hacen R6.1/R6.4 y el código de `db/bootstrap.ts`.

**[RC-01] Refuerzo de convergencia.** Delta sobre lo implementado en 773823a:
- **Vigilante único:** se retiran `/api/simulation/*` y el vigilante provisional de la spec 003
  (`rules/watchmanRule.ts`, `services/movementService.ts`, `controllers/simulationController.ts`,
  `routes/simulationRoutes.ts`) y las rutas `/api/robot/*` (singular).
- **Registro de transiciones:** `state_transition_log` (append-only); `MOVING` y `RECOVERING` se
  persisten dentro de la transacción y cada cambio se registra con su causa.
- **Multi-robot:** `robot_state` pasa a una fila por robot (FK a `robots`, catálogo de la spec 003)
  y las rutas a `/api/robots/:robotId/*`.
- **Sesión y secuencia:** tabla `robot_sessions`; la validación va antes del vigilante.
- **Incidentes consultables:** `robot_id` y `rule` en `incidents`; `GET /api/incidents/:id`.
- **Endurecimiento:** lecturas sin relocalización (`POSITION_CONFLICT`), señal de pérdida →
  `DEGRADED`, `recover` con `transitioned` y `cause`.

## Architecture

```
                       Backend (Express)
┌─────────────────────────────────────────────────────────────┐
│ robotController / incidentController   (solo recibe/responde) │
│        │                                                       │
│        ▼                                                       │
│ guardianService ── evaluateMovement (pura) ── stateMachine     │
│        │                 │ usa isCollision (spec 001)          │
│        │                 ▼                                      │
│        ├── zoneRepository (puede fallar → ZONE_DATA_UNAVAILABLE)│
│        ├── robotRepository (estado, posición, positionQuality) │
│        └── incidentRepository (append-only)                    │
└─────────────────────────────────────────────────────────────┘
                 ▲                        │
   @home-guardian/domain (tipos)          ▼  SQLite (better-sqlite3, sin ORM)
```

La decisión es independiente del frontend (art. III). Funcionalidad vertical: API → reglas →
persistencia. La spec 003 consume este contrato para mostrar la decisión.

**[RC-01] Arquitectura resultante.** El servicio recibe además `transitionLog` y `sessions`, y
trabaja siempre sobre un `robotId`. `app.ts` no monta ya `/api/simulation` ni `/api/robot`; monta
el catálogo de la spec 003 en `/api/robots` y, debajo, las rutas del vigilante en
`/api/robots/:robotId` (router con `mergeParams`). Solo `guardianService` y `db/bootstrap.ts`
escriben en `robot_state` (Property 12).

## Components and Interfaces

### 1. `@home-guardian/domain` (añadidos de esta spec)

```ts
export type RobotStateName = 'IDLE' | 'MOVING' | 'SAFE_STOP' | 'DEGRADED' | 'RECOVERING';
export type PositionQuality = 'RELIABLE' | 'UNRELIABLE' | 'MISSING';

export type DecisionCode =
  | 'AUTHORIZED'
  | 'ORIGIN_IN_RESTRICTED_ZONE' | 'RESTRICTED_ZONE_VIOLATION' | 'TRAJECTORY_CROSSES_ZONE'
  | 'INSUFFICIENT_DATA' | 'MISSING_POSITION' | 'ZONE_DATA_UNAVAILABLE'
  | 'SAFE_STOP_ACTIVE' | 'BUSY';

export interface GuardianInput {
  state: RobotStateName;
  positionQuality: PositionQuality;
  origin: Point;
  destination: Point;
  zones: Zone[] | null;   // null = repositorio no disponible
  pad?: number;           // por defecto COLLISION_PAD (spec 001)
}

export interface GuardianDecision {
  code: DecisionCode;
  authorized: boolean;
  nextState: RobotStateName;
  collisionType: CollisionType | null;  // reutilizado de spec 001
  reason: string;
}

// Lectura de posición aportada explícitamente (sustituto de prototipo de HU-06).
export interface PositionReading {
  position: Point;
  quality: PositionQuality;   // en la línea base se admite 'RELIABLE'
}
```

**[RC-01] Añadidos al dominio** (aditivos; no rompen los tipos existentes):
```ts
export type RobotId = number;

/** Causas registradas en state_transition_log (R9). */
export type TransitionCause =
  | 'AUTHORIZED' | 'MOVE_COMPLETED'
  | 'ORIGIN_IN_RESTRICTED_ZONE' | 'RESTRICTED_ZONE_VIOLATION' | 'TRAJECTORY_CROSSES_ZONE'
  | 'INSUFFICIENT_DATA' | 'MISSING_POSITION' | 'ZONE_DATA_UNAVAILABLE'
  | 'RECOVER_REQUESTED' | 'RECOVER_COMPLETED'
  | 'POSITION_QUALITY_LOST' | 'BOOTSTRAP_MOVING_PERSISTED' | 'ROBOT_REGISTERED';

export type RecoveryRejectionCause = 'UNRELIABLE_DATA' | 'ZONE_DATA_UNAVAILABLE' | 'UNSAFE_POSITION';

export interface LastRequest { sessionId: string; sequence: number; destination: Point; acceptedAt: string; }

/** GET /api/robots/:robotId/state */
export interface RobotStatus {
  robotId: RobotId; state: RobotStateName; position: Point;
  positionQuality: PositionQuality; lastRequest: LastRequest | null;
}

/** POST /api/robots/:robotId/recover (200) */
export interface RecoverResponse extends Omit<RobotStatus, 'lastRequest'> { transitioned: boolean; }

/** Cuerpo de POST /api/robots/:robotId/move */
export interface GuardedMoveRequest { destination: Point; sessionId: string; sequence: number; }

/** GET /api/incidents (resumen) y GET /api/incidents/:id (detalle) */
export interface Incident {
  id: number; robotId: RobotId | null; robotName: string | null;
  rule: RuleId;                       // RuleId y RULES los define la spec 001
  zoneName: string | null; decisionCode: DecisionCode; collisionType: CollisionType | null;
  stateAfter: RobotStateName; origin: Point; destination: Point; reason: string;
  createdAt: string;                  // ISO-8601
}
export interface IncidentDetail extends Incident { zonesSnapshot: Zone[]; }
```
Esquemas Zod: `guardedMoveRequestSchema` (`destination` = `pointSchema`, `sessionId` =
`z.string().uuid()`, `sequence` = `z.number().int().min(1)`), `robotIdParamSchema`,
`incidentIdParamSchema` e `incidentListQuerySchema` (`robotId` opcional). `GuardianDecision`
añade `zoneName: string | null` para guardar la zona en el incidente.

### 2. Regla pura del vigilante — `rules/guardian.ts`

```ts
// Orden estricto; se detiene en la primera condición que aplique (R2.5).
export function evaluateMovement(input: GuardianInput): GuardianDecision {
  // 1. Estado no admite movimiento:
  //    SAFE_STOP/DEGRADED/RECOVERING → SAFE_STOP_ACTIVE (REJECTED, sin incidente nuevo)
  //    MOVING ocupado               → BUSY
  // 2. positionQuality === 'UNRELIABLE' → INSUFFICIENT_DATA  (nextState DEGRADED)
  // 3. positionQuality === 'MISSING'    → MISSING_POSITION   (nextState DEGRADED)
  // 4. zones === null (repo caído)      → ZONE_DATA_UNAVAILABLE (nextState SAFE_STOP)
  // 5-7. geometría: para cada zona activa, isCollision(zone, {origin,destination}, pad)
  //      ORIGIN_IN_RESTRICTED_ZONE | RESTRICTED_ZONE_VIOLATION | TRAJECTORY_CROSSES_ZONE
  //      (respeta prioridad de isCollision: origen > destino > trayectoria) → SAFE_STOP
  // 8. AUTHORIZED → nextState MOVING (transitorio). El movimiento se completa de forma
  //    inmediata en el servicio; el estado persistido final es IDLE (ver §4).
}
```
> Pura y determinista (R7.3): salida función de las entradas. No persiste ni registra; eso lo
> hace el servicio. Ejecutable con zonas en memoria (T-12), sin BD.

**[RC-01] `evaluateRecovery` (pura).** Hoy la validación de `recover` vive en el servicio
(`isSafePosition`). Se extrae a `rules/guardian.ts` para probarla sin BD:
```ts
export function evaluateRecovery(input: {
  positionQuality: PositionQuality; position: Point; zones: Zone[] | null; pad?: number;
}): { allowed: true } | { allowed: false; cause: RecoveryRejectionCause };
// Orden (R4.4): positionQuality !== 'RELIABLE' → UNRELIABLE_DATA; zones === null →
// ZONE_DATA_UNAVAILABLE; posición dentro de una zona ACTIVA expandida por pad → UNSAFE_POSITION.
// Las zonas con active === false se ignoran (defensa en profundidad).
```
`ruleForDecision(code: DecisionCode): RuleId` (pura) traduce el código de denegación a la regla
del catálogo `RULES` de la spec 001 (R5.5).

### 3. Máquina de estados — `rules/stateMachine.ts`

```ts
// Transiciones permitidas y PROHIBIDAS (P-1, P-2).
export function canTransition(from: RobotStateName, to: RobotStateName,
                              positionQuality: PositionQuality): boolean {
  // P-1: SAFE_STOP y DEGRADED -> MOVING prohibido (solo vía RECOVERING -> IDLE).
  // P-2: cualquier -> MOVING con positionQuality != 'RELIABLE' prohibido.
  // ...resto según tabla de transiciones de requirements §2.2.
}
export function applyDecision(current: RobotStateName,
                              decision: GuardianDecision): RobotStateName;

// Movimiento completado: MOVING -> IDLE. En el prototipo síncrono el servicio invoca
// completeMove inmediatamente tras un AUTHORIZED, por lo que el estado persistido es IDLE.
export function completeMove(current: RobotStateName): RobotStateName; // MOVING -> IDLE
```

**[RC-01] Transiciones persistidas.** El servicio aplica cada transición con un único helper,
`transition(robotId, from, to, cause, detail?)`, que (1) comprueba `canTransition`, (2) escribe
`robot_state` y (3) inserta en `state_transition_log`, todo en la transacción en curso. Lista de
transiciones alcanzables con su causa:

| # | De → A | Causa | Origen |
|---|--------|-------|--------|
| T1 | `IDLE → MOVING` | `AUTHORIZED` | `move` |
| T2 | `MOVING → IDLE` | `MOVE_COMPLETED` | `move` (misma transacción) |
| T3 | `IDLE → SAFE_STOP` | código geométrico o `ZONE_DATA_UNAVAILABLE` | `move` |
| T4 | `IDLE → DEGRADED` | `INSUFFICIENT_DATA` / `MISSING_POSITION` | `move` |
| T5 | `IDLE → DEGRADED` | `POSITION_QUALITY_LOST` | `position` |
| T6 | `SAFE_STOP/DEGRADED → RECOVERING` | `RECOVER_REQUESTED` | `recover` |
| T7 | `RECOVERING → IDLE` | `RECOVER_COMPLETED` | `recover` (misma transacción) |
| T8 | `MOVING → SAFE_STOP` | `BOOTSTRAP_MOVING_PERSISTED` | arranque |
| T9 | `∅ → IDLE` | `ROBOT_REGISTERED` | alta de robot (spec 003) |

`canTransition` deja de aceptar cualquier otra pareja: es una lista blanca (las celdas de la
tabla §2.2 de requirements que el orden de §3 hace inalcanzables quedan como "rechazo sin
transición").

### 4. Servicio — `services/guardianService.ts`
Orquesta (SOLID-D, inyección manual de repositorios):
1. Lee snapshot del robot (`state`, `position`, `positionQuality`) de `robotRepository`.
2. Carga zonas activas de `zoneRepository`; si lanza, pasa `zones = null`.
3. Llama a `evaluateMovement`.
4. Aplica la transición con `applyDecision`/`canTransition` y persiste el nuevo estado.
   En `AUTHORIZED`, actualiza la posición al destino y, como el movimiento se completa de
   inmediato, invoca `completeMove` (`MOVING → IDLE`) persistiendo `IDLE`; así el siguiente
   movimiento no se rechaza con `BUSY`.
5. **Registra la evaluación** (siempre) con `collisionType`/causa y **snapshot de zonas**.
6. Si la decisión es una **denegación que para** (no un mero rechazo por estado), **crea un
   incidente** y devuelve su `incidentId`.
7. Si la solicitud se **rechaza por estado** (`SAFE_STOP_ACTIVE`/`BUSY`), registra el rechazo
   en el **log de auditoría** (tabla `audit_log`) sin crear incidente (R5.3).

**[RC-01] Delta del servicio** (todas las operaciones reciben `robotId` y corren en una transacción
`IMMEDIATE`):

`move(robotId, { destination, sessionId, sequence })`
1. Robot inexistente → `404 ROBOT_NOT_FOUND`.
2. `assertDestinationWithinFloor` → `422 DESTINATION_OUT_OF_BOUNDS`. Esta función vive hoy en
   `movementService.ts` (spec 003); se **traslada** a `guardianService` (o a un módulo
   `services/floorBounds.ts`) antes de retirar `movementService`.
3. Sesión vigente del robot ≠ `sessionId` → `409 INVALID_SESSION` (auditado).
4. `sequence ≤ lastSequence` → `409 DUPLICATE_EVENT` (auditado). Si pasa, la secuencia se consume.
5. `evaluateMovement` con la fila del robot.
6. `AUTHORIZED` → T1 + T2 (posición = destino). `DENIED` → crea el incidente (con `robot_id`,
   `rule = ruleForDecision(code)`, `zoneName`) y aplica T3/T4 con el `incidentId` en `detail`.
   `REJECTED` → audita, sin transición.
7. Persiste `lastRequest` en `robot_sessions`.

`recover(robotId)` → `IDLE`: `200 transitioned:false` + audit `RECOVER_NOOP`. Parada:
`evaluateRecovery`; rechazo → `409 RECOVERY_NOT_ALLOWED` + `cause` + audit; permitido → T6 + T7
(con snapshot de zonas en `detail`) y `200 transitioned:true`.

`setPosition(robotId, reading)` → `RELIABLE`: coincide con la posición actual → fija la calidad;
no coincide → `409 POSITION_CONFLICT`; fuera del plano → `422 POSITION_OUT_OF_BOUNDS`.
`UNRELIABLE`/`MISSING`: fija la calidad, ignora la posición y, si el robot está en `IDLE`, aplica
T5. Siempre audita (`POSITION_READING`/`POSITION_CONFLICT`).

`startSession(robotId)` → genera un UUID, sustituye la sesión vigente (`last_sequence = 0`) y
audita `SESSION_STARTED`.

`initRobot(robotId)` → crea la fila de estado inicial (`IDLE`, `RELIABLE`, (120, 90)) y aplica T9.
La invoca el servicio de catálogo de la spec 003 dentro de la misma transacción que el alta, para
que nadie más escriba en `robot_state`.

`getState(robotId)` → `RobotStatus`.

Registro de evaluaciones (R5.1) tras el refuerzo: `AUTHORIZED` queda en `state_transition_log`
(T1 con destino, sesión y secuencia en `detail`); las denegaciones en `incidents` + transición; los
rechazos en `audit_log`. La tabla `movement_log` de la spec 003 deja de recibir filas (se conserva
como histórico).

### 5. Recuperación — `POST /api/robot/recover`
```ts
// Precondiciones (R4): estado en {SAFE_STOP, DEGRADED}; posición SEGURA (fuera de toda zona)
// y positionQuality === 'RELIABLE'. Cumplidas → RECOVERING → IDLE. Si no → rechazo, sin cambio.
// Fuera de parada → idempotente/rechazo sin efectos (R4.3).
```
> *Sustituido por RC-01:* ruta `POST /api/robots/:robotId/recover`; respuesta con `transitioned`;
> rechazo `409 RECOVERY_NOT_ALLOWED` con `cause` (hoy responde `{ recovered: false, reason }`);
> "posición segura" = fuera de toda zona **activa** expandida por r+m; se persiste `RECOVERING` y
> se registran T6 y T7.

### 5b. Aporte de lectura de posición — `POST /api/robot/position`
```ts
// Valida PositionReading con Zod (quality admitido; position dentro del plano).
// Fija robotRepository.position = reading.position y positionQuality = reading.quality.
// Es la vía explícita para que positionQuality llegue a 'RELIABLE' sin sensores (HU-06
// reservada). No evalúa geometría de movimiento; solo registra la lectura.
```
> Resuelve el bloqueo PD-09: sin esta vía, tras el arranque (`MISSING`) el robot nunca podría
> moverse ni recuperarse. El seed deja `RELIABLE`; solo el reinicio vuelve a `MISSING`.

> *Sustituido por RC-01:* una lectura **nunca relocaliza** el robot (hoy `setPosition` fija
> cualquier posición, lo que permite liberar un robot "teletransportándolo" fuera de una zona y
> mover el robot en `IDLE` sin pasar por el vigilante). Ver el delta del servicio (R8.5–R8.7) y la
> señal de pérdida → `DEGRADED` (R3.6). El arranque no vuelve a `MISSING` (R6.4).

### 6. Reinicio seguro (ADR-10) — `db/bootstrap.ts`
Al **arrancar**: el robot parte con `positionQuality = RELIABLE` y estado `IDLE` (seed). No se
pone `MISSING` por el solo hecho de reiniciar; `positionQuality` pasa a `MISSING`/`UNRELIABLE`
**solo** ante una señal de pérdida explícita (`POST /api/robot/position`). Si el estado
persistido es `MOVING` → `SAFE_STOP` (no se reanuda un movimiento a ciegas).

**[RC-01]** El arranque recorre **todos** los robots y aplica T8 mediante el helper `transition`
(con su fila en `state_transition_log`). Se ejecuta tras las migraciones en `server.ts` y también
en `npm run migrate` (`db/init.ts`). R6.3 se prueba sembrando `MOVING` directamente en la base.

### 7. Controllers y rutas
```
packages/backend/src/
├── controllers/robotController.ts      # state, move, recover, position
├── controllers/incidentController.ts   # list incidents
├── services/guardianService.ts
├── rules/guardian.ts                   # evaluateMovement (pura)
├── rules/stateMachine.ts               # transiciones + prohibiciones
├── repositories/robotRepository.ts
├── repositories/incidentRepository.ts  # append-only
├── routes/robotRoutes.ts               # /api/robot/*
├── routes/incidentRoutes.ts            # /api/incidents
├── schemas/robot.schema.ts             # moveSchema, positionSchema
└── db/bootstrap.ts                     # reinicio seguro
```

#### Mapeo decisión → HTTP (controller)
| Decisión | HTTP | Cuerpo |
|----------|------|--------|
| `AUTHORIZED` | 200 | nueva posición + estado `IDLE` (MOVING transitorio, completado) |
| Denegación geométrica / por datos | 200 | `decision: DENIED` + `code`/`collisionType` + `incidentId` |
| Rechazo por estado (`SAFE_STOP_ACTIVE`/`BUSY`) | 409 | `decision: REJECTED` + `code` + estado |
| `POST /position` OK | 200 | posición + `positionQuality` |
| `POST /recover` OK | 200 | estado `IDLE` + posición |
| payload inválido | 422 | `{ code: 'INVALID_DESTINATION' | 'INVALID_POSITION', message }` |
| **[RC-01]** Robot o incidente inexistente | 404 | `{ code: 'ROBOT_NOT_FOUND' \| 'INCIDENT_NOT_FOUND', message }` |
| **[RC-01]** Sesión inválida / secuencia repetida | 409 | `{ code: 'INVALID_SESSION' \| 'DUPLICATE_EVENT', message }` |
| **[RC-01]** `POST /recover` en `IDLE` | 200 | `RecoverResponse` con `transitioned: false` |
| **[RC-01]** `POST /recover` rechazado | 409 | `{ code: 'RECOVERY_NOT_ALLOWED', cause, message }` |
| **[RC-01]** `POST /position` `RELIABLE` no coincidente | 409 | `{ code: 'POSITION_CONFLICT', message }` |
| **[RC-01]** `POST /sessions` | 201 | `{ sessionId }` |
| **[RC-01]** `GET /api/incidents[?robotId]`, `/:id` | 200 | `Incident[]` / `IncidentDetail` |

**[RC-01] Rutas tras el refuerzo**
```
packages/backend/src/
├── routes/guardianRoutes.ts     # /api/robots/:robotId/{state,sessions,move,recover,position} (mergeParams)
├── routes/incidentRoutes.ts     # /api/incidents, /api/incidents/:id
├── repositories/transitionLogRepository.ts   # append-only
├── repositories/sessionRepository.ts         # sesión vigente y última solicitud por robot
└── services/floorBounds.ts      # assertDestinationWithinFloor trasladado desde movementService

Se ELIMINAN: routes/robotRoutes.ts (/api/robot singular, sustituida por guardianRoutes),
routes/simulationRoutes.ts, controllers/simulationController.ts, services/movementService.ts,
rules/watchmanRule.ts y sus pruebas; tipos Decision/MoveResult/RobotSnapshot de la spec 003.
```
El catálogo (`/api/robots`, `/api/robots/:robotId`) lo monta la spec 003; ambos routers comparten
el prefijo `/api/robots`.

## Data Models

### Tabla `incidents` (append-only)
```sql
CREATE TABLE IF NOT EXISTS incidents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_code  TEXT    NOT NULL,   -- ORIGIN_IN_RESTRICTED_ZONE | ... | ZONE_DATA_UNAVAILABLE
  collision_type TEXT,               -- nullable (null en causas de datos)
  state_after    TEXT    NOT NULL,
  origin_x       REAL    NOT NULL,
  origin_y       REAL    NOT NULL,
  dest_x         REAL    NOT NULL,
  dest_y         REAL    NOT NULL,
  zones_snapshot TEXT    NOT NULL,   -- JSON con las zonas usadas en la decisión
  reason         TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
```
> Inmutable: solo `INSERT` (R5.4; regla de incidentes del steering de seguridad). Las
> migraciones son SQL versionadas (spec 001, DD-005).

### Tabla `audit_log` (append-only, rechazos por estado)
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_code  TEXT    NOT NULL,   -- SAFE_STOP_ACTIVE | BUSY
  state       TEXT    NOT NULL,   -- estado en el momento del rechazo
  dest_x      REAL    NOT NULL,
  dest_y      REAL    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```
> Registra los rechazos por estado para auditoría (R5.3); no son incidentes. Append-only.

### Tabla `robot_state` (singleton; extiende la de la spec 003)
```sql
-- Añade la columna de calidad de posición al estado del robot.
ALTER TABLE robot_state ADD COLUMN position_quality TEXT NOT NULL DEFAULT 'MISSING';
```
> El **seed** inserta el robot con `position_quality = 'RELIABLE'` y una posición válida.
> El `DEFAULT 'MISSING'` solo aplica a filas no sembradas; el arranque normal conserva
> `RELIABLE` del seed y solo una señal de pérdida explícita lo cambia (ADR-10, `db/bootstrap.ts`).

### [RC-01] Migraciones del refuerzo
Numeración global propuesta (a coordinar con las specs 001 y 003, que añaden sus propias
migraciones en el mismo refuerzo). Prerrequisito: la migración de la spec 003 que crea `robots` y
siembra "Aspiradora A1" (160, 123) y "Vigilante V2" (488, 290), prevista como
`007_create_robots.sql`.

| Migración | Contenido |
|-----------|-----------|
| `008_robot_state_per_robot.sql` | Reconstruye `robot_state` con `robot_id INTEGER PRIMARY KEY REFERENCES robots(id)`, los 5 estados, `position_quality DEFAULT 'RELIABLE'` (corrige el `'MISSING'` de la 005) y `updated_at`. Copia la fila `id = 1` como estado de "Aspiradora A1" (conserva estado, posición y calidad) e inserta el estado inicial de "Vigilante V2" en (488, 290). |
| `009_incidents_robot_rule.sql` | `ALTER TABLE incidents ADD COLUMN robot_id INTEGER REFERENCES robots(id)` y `ADD COLUMN rule TEXT`. Las filas existentes quedan con `NULL` (no se reescriben: tabla append-only); el repositorio deriva `rule` del `decision_code` al leerlas y devuelve `robotId: null`. Las filas nuevas los exigen (validado en el repositorio y con prueba). |
| `010_create_state_transition_log.sql` | Tabla `state_transition_log` + triggers append-only. |
| `011_audit_log_generalize.sql` | Reconstruye `audit_log` copiando **todas** las filas sin modificarlas: añade `robot_id`, hace `x`/`y` nullable (antes `dest_x`/`dest_y NOT NULL`) y añade `detail`; amplía `event_code` (CHECK) a `SAFE_STOP_ACTIVE`, `BUSY`, `INVALID_SESSION`, `DUPLICATE_EVENT`, `SESSION_STARTED`, `RECOVER_NOOP`, `RECOVERY_NOT_ALLOWED`, `POSITION_READING`, `POSITION_CONFLICT`. Recrea los triggers. |
| `012_create_robot_sessions.sql` | Tabla `robot_sessions` (una fila por robot). **La crea la spec 003** (dueña del requisito de sesiones); aquí solo se consume. |

```sql
CREATE TABLE IF NOT EXISTS state_transition_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  robot_id   INTEGER NOT NULL REFERENCES robots(id),
  from_state TEXT CHECK (from_state IS NULL OR from_state IN
               ('IDLE','MOVING','SAFE_STOP','DEGRADED','RECOVERING')),
  to_state   TEXT NOT NULL CHECK (to_state IN
               ('IDLE','MOVING','SAFE_STOP','DEGRADED','RECOVERING')),
  cause      TEXT NOT NULL,      -- TransitionCause
  detail     TEXT,               -- JSON opcional: destino/sesión/secuencia, incidentId, snapshot
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_state IS NOT NULL OR cause = 'ROBOT_REGISTERED')
);

CREATE TABLE IF NOT EXISTS robot_sessions (
  robot_id         INTEGER PRIMARY KEY REFERENCES robots(id),
  session_id       TEXT    NOT NULL UNIQUE,
  last_sequence    INTEGER NOT NULL DEFAULT 0,
  last_dest_x      REAL,
  last_dest_y      REAL,
  last_accepted_at TEXT,
  started_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```
> `robot_sessions` no es un registro: guarda solo la sesión vigente (se sobrescribe al iniciar
> otra). El historial de sesiones queda en `audit_log` (`SESSION_STARTED`).
> Notas: SQLite no cambia `PRAGMA foreign_keys` dentro de una transacción, y las reconstrucciones
> (008, 011) se hacen dentro de la transacción de `migrate.ts`; ninguna tabla referencia todavía
> `robot_state` ni `audit_log`, así que el `DROP` es seguro. No se añaden transiciones retroactivas
> por el pasado (no se fabrican registros, art. XV).

## Error Handling

- `AppError(status, code, message)` como en la spec 001; `errorHandler` → `{ code, message }`
  sin stack trace (R7.2).
- Denegaciones (geométricas y por datos): **no** son errores de transporte → `200` con la
  decisión en el cuerpo.
- Rechazos por estado (`SAFE_STOP_ACTIVE`, `BUSY`): `409`.
- `ZONE_DATA_UNAVAILABLE` es una **decisión** (200, parada), no un 500: el fallo del
  repositorio se captura en el servicio y se traduce a fallo seguro, nunca se propaga crudo.
- **[RC-01]** `AppError` admite un `cause` opcional y el `errorHandler` lo serializa
  (`{ code, cause, message }`) para el 409 de `recover`. `REJECTED` no es un error: es un
  `MoveResponse` con 409. Cualquier excepción revierte la transacción completa (estado,
  transiciones, incidente, auditoría y sesión).

## Correctness Properties

### Property 1: Orden de evaluación respetado
Dadas varias condiciones simultáneas, la decisión corresponde a la primera en el orden
estado → `UNRELIABLE` → `MISSING` → repo caído → origen → destino → trayectoria → `AUTHORIZED`.

**Validates: Requirements 2.5**

### Property 2: Datos antes que geometría
Si `positionQuality` no es `RELIABLE` o el repositorio de zonas falla, la decisión es de datos
(`INSUFFICIENT_DATA`/`MISSING_POSITION`/`ZONE_DATA_UNAVAILABLE`) y la geometría no se evalúa.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 3: Fallo seguro en la denegación
Toda denegación produce un estado de parada preventiva (`SAFE_STOP` o `DEGRADED`) y nunca deja
el robot en `MOVING`.

**Validates: Requirements 3.1, 3.2**

### Property 4: Transiciones prohibidas
`SAFE_STOP → MOVING` y `DEGRADED → MOVING` nunca ocurren (P-1), y ninguna transición a
`MOVING` ocurre con `positionQuality` distinto de `RELIABLE` (P-2).

**Validates: Requirements 3.4, 3.5**

### Property 5: Recuperación validada
La transición de salida de parada a `IDLE` (vía `RECOVERING`) ocurre si y solo si la posición
es segura y `positionQuality` es `RELIABLE`.

**Validates: Requirements 4.1, 4.2**

### Property 6: Incidente por denegación, no por rechazo
Cada denegación que para crea exactamente un incidente; un rechazo por estado
(`SAFE_STOP_ACTIVE`/`BUSY`) no crea incidente pero se registra en el log de auditoría.

**Validates: Requirements 5.2, 5.3**

### Property 7: Reinicio seguro
Tras el arranque, `positionQuality` es `RELIABLE` (seed) y un `MOVING` persistido queda en `SAFE_STOP`; `MISSING` solo ocurre ante una señal de pérdida explícita.

**Validates: Requirements 6.1, 6.2**

### Property 8: Determinismo y pureza
Para las mismas entradas (`state`, `positionQuality`, `origin`, `destination`, `zones`, `pad`),
`evaluateMovement` devuelve siempre la misma decisión, sin efectos secundarios.

**Validates: Requirements 7.3**

### Property 9: Vivacidad del movimiento (sin bloqueo en MOVING)
Un movimiento `AUTHORIZED` deja el robot en `IDLE` al completarse (MOVING es transitorio);
por tanto, dos movimientos válidos consecutivos ambos pueden autorizarse y ninguno se rechaza
con `BUSY` por culpa del anterior.

**Validates: Requirements 1.5**

### Property 10: Una lectura confiable habilita el movimiento
Si `positionQuality` es `MISSING`/`UNRELIABLE` (por una señal de pérdida explícita) y luego se aporta una lectura con
`quality = RELIABLE` vía `POST /api/robot/position`, entonces un movimiento posterior a un
destino libre deja de denegarse por datos y puede autorizarse (no hay bloqueo permanente).

**Validates: Requirements 8.1, 8.3**

### Property 11 [RC-01]: Toda transición queda registrada
Para cualquier secuencia de operaciones sobre un robot, las filas de `state_transition_log` de
ese robot reproducen exactamente la secuencia de estados persistidos; ninguna operación sin cambio
de estado añade filas.

**Validates: Requirements 9.1–9.7**

### Property 12 [RC-01]: Vigilante único
Solo `guardianService` y `db/bootstrap.ts` escriben en `robot_state`, y no existe ruta HTTP fuera
de `/api/robots/:robotId/*` que mueva un robot o lo saque de la parada. Se verifica con (a) una
prueba de arquitectura que recorre los imports de `src` (incluidos `import type`) y busca el
literal `robot_state` en sentencias SQL fuera de `repositories/robotRepository.ts`, y (b)
`/api/simulation/*` y `/api/robot/*` → 404.

**Validates: Requirements 10.1–10.3**

### Property 13 [RC-01]: Una lectura nunca relocaliza
Para toda lectura de posición, la posición persistida del robot después de la lectura es igual a
la de antes.

**Validates: Requirements 8.5, 8.6**

### Property 14 [RC-01]: Secuencia estrictamente creciente
Dentro de una sesión, ninguna solicitud con `sequence` menor o igual que la última aceptada
llega al vigilante, cambia el estado o crea un incidente.

**Validates: Requirements 11.3–11.5, 5.8**

### Property 15 [RC-01]: Aislamiento entre robots
Una operación sobre el robot A no cambia el estado, la posición, la calidad ni la sesión del
robot B.

**Validates: Requirements 12.1, 12.4**

## Testing Strategy

| Nivel | Objetivo | Casos |
|-------|----------|-------|
| Unit (rules) | `evaluateMovement` + `stateMachine` | **T-12**: A(9), B(5), C(3), D(r=10, 5), E(m=5, 3), F(2), G(1) = 28 |
| Unit (rules) | transiciones prohibidas | P-1, P-2 explícitas |
| Unit (service) | orquestación | registro siempre, incidente solo en denegación, rechazo sin incidente, recover válido/ inválido, bootstrap ADR-10 |
| Unit (rules) | vivacidad MOVING→IDLE | dos movimientos válidos seguidos, ambos AUTHORIZED |
| Integración (Supertest) | `/api/robot`, `/api/incidents` | state, move 200/409/422, position, recover, incidents append-only |
| Integración (Supertest) | habilitación por lectura | tras reinicio MISSING → position RELIABLE → move AUTHORIZED |
| (UI la cubre la spec 003) | — | — |

> T-12 usa un **doble de `zoneRepository`** (zonas en memoria; caso G simula el fallo) y un
> **doble de `robotRepository`**; no requiere frontend ni base de datos real (R7.4).

**[RC-01] Pruebas añadidas** (todas con la prueba en rojo antes de implementar):

| Nivel | Objetivo | Casos |
|-------|----------|-------|
| Unit (rules) | `canTransition` lista blanca | T1–T9 aceptadas; cualquier otra pareja rechazada |
| Unit (rules) | `evaluateRecovery`, `ruleForDecision` | 3 causas en orden y caso permitido; mapeo de los 6 códigos de denegación |
| Unit (db) | migraciones 008–012 | copia de la fila `id = 1` a "Aspiradora A1", estado de "Vigilante V2", filas de `audit_log` conservadas, triggers append-only |
| Unit (service) | Property 11, 13, 14, 15 | transiciones exactas por operación; lecturas sin relocalización; `DUPLICATE_EVENT`/`INVALID_SESSION` sin evaluar; aislamiento entre robots |
| Unit (bootstrap) | T8 por robot | dos robots, uno en `MOVING` sembrado |
| Arquitectura | Property 12 | imports y literal `robot_state` |
| Integración (Supertest) | API por robot | `404 ROBOT_NOT_FOUND`; secuencia denegado → rechazado → recover con las filas exactas de `state_transition_log` y `audit_log`; incidentes con `rule` y `/:id`; `/api/simulation/*` y `/api/robot/*` → 404 |

## Decisiones de diseño

| ID | Decisión | Alternativa descartada | Justificación |
|----|----------|------------------------|---------------|
| DD-201 | Orden estricto en `evaluateMovement` | Evaluar todo y combinar | Predecible, fácil de verificar, fallo seguro por datos |
| DD-202 | Datos antes que geometría | Geometría primero | Sin posición fiable no hay geometría válida (art. III) |
| DD-203 | Denegación = 200 con decisión; rechazo por estado = 409 | Todo 4xx | La denegación es una decisión válida; el rechazo es conflicto de estado |
| DD-204 | `ZONE_DATA_UNAVAILABLE` como decisión de parada, no 500 | Propagar error | Fallo seguro ante repositorio caído |
| DD-205 | `incidents` append-only con `zones_snapshot` JSON | Log mutable / sin snapshot | Trazabilidad e inmutabilidad (art. VI; steering seguridad) |
| DD-206 | Recuperación solo vía `recover` con doble validación | Auto-recuperación | Salida explícita y validada de SAFE_STOP (P-1) |
| DD-207 | Reinicio seguro degrada `MOVING`→`SAFE_STOP` (ADR-10) | Reanudar movimiento | No mover a ciegas tras reinicio |
| DD-208 | Reutilizar `isCollision`/`CollisionType` (spec 001) | Reimplementar geometría | Fuente única; sin duplicación |
| DD-209 | `MOVING` transitorio; el servicio completa a `IDLE` en la misma solicitud | Dejar `MOVING` persistente | Evita bloqueo `BUSY` permanente tras el primer movimiento (defecto corregido) |
| DD-210 | `POST /api/robot/position` + seed `RELIABLE`; reinicio → `MISSING` | Esperar sensores (HU-06) | Sustituto de prototipo explícito; evita el bloqueo PD-09 sin salida |
| DD-211 [RC-01] | Vigilante único; retirada de `/api/simulation/*` y `/api/robot/*` | Mantener ambos | Dos caminos al estado violan el art. III; el `reset` sin registro era el hallazgo B-1 |
| DD-212 [RC-01] | `state_transition_log` con helper `transition` | Registrar desde cada rama del servicio | Un solo punto garantiza que ninguna transición se escape (Property 11) |
| DD-213 [RC-01] | `MOVING` y `RECOVERING` se persisten dentro de la transacción | Mantenerlos solo en memoria (DD-209) | El registro debe coincidir con lo persistido; sustituye la parte de DD-209 que no persistía `MOVING` |
| DD-214 [RC-01] | Estado por robot (`robot_state.robot_id`) | Fila única | Catálogo de robots de la HU-01 del prototipo (spec 003) |
| DD-215 [RC-01] | Sesión vigente + secuencia estrictamente creciente, validadas antes del vigilante | Idempotencia por clave arbitraria | Modelo del prototipo (robot, sesión, secuencia); un reintento no duplica incidentes |
| DD-216 [RC-01] | Lectura `RELIABLE` solo si coincide con la posición actual | Permitir relocalizar | Cierra el "teletransporte" para salir de una parada |
| DD-217 [RC-01] | Señal de pérdida en `IDLE` → `DEGRADED`, sin incidente | Esperar al siguiente `move` | Fallo seguro inmediato (art. III); el incidente modela evaluaciones de movimiento |
| DD-218 [RC-01] | `rule` guardada en el incidente; filas antiguas sin reescribir | Derivarla siempre al leer | El incidente documenta la regla vigente al decidir; el histórico es inmutable |
| DD-219 [RC-01] | `audit_log` reconstruida copiando todas las filas | Tabla de auditoría nueva | Un único log de eventos sin transición; no se pierde ni altera ninguna fila |
| DD-220 [RC-01] | `initRobot` en `guardianService`, invocado por el alta de la spec 003 | Que el catálogo escriba `robot_state` | Mantiene un único escritor (Property 12) |

## Dependencias entre HU
- HU-04/HU-05 dependen de la spec 001 (geometría). La spec 003 consume este contrato.
- `robot_state` se comparte con la spec 003 (esta spec añade `position_quality`).
- **[RC-01]** Depende de la spec 003 para la tabla `robots` y su seed, y de la spec 001 para el
  catálogo `RULES`. La spec 003 depende de esta para las rutas `/api/robots/:robotId/*`,
  `initRobot` y el contrato de incidentes. La retirada de `/api/simulation/*` se integra en la
  misma entrega que la migración de la UI de la spec 003.

## Compuerta Fase 2 (DISEÑAR)
- [ ] El humano aprueba explícitamente este `design.md`.
- [ ] Se confirma el mapeo decisión→HTTP (DD-203) y el trato de `ZONE_DATA_UNAVAILABLE` (DD-204).
- [ ] Se confirma el reinicio seguro ADR-10 (DD-207).
- [ ] **[RC-01]** Se confirma el refuerzo: vigilante único (DD-211), registro de transiciones (DD-212, DD-213), estado por robot (DD-214), sesión y secuencia (DD-215) y lecturas sin relocalización (DD-216).

## Preguntas abiertas [RC-01]
- **Q-A.** Autenticación del operador (HU-02/HU-05 del prototipo; stack con bcrypt + JWT): ¿requisito transversal ahora (spec 001) o deuda documentada?
- **Q-B.** Botón "Perder conexión" en la UI: ¿se habilita usando `POST /api/robots/:robotId/position` con `MISSING`, o queda reservado como inyección de fallos?
- **Q-C.** Aprobación formal de esta spec, implementada en 773823a pero aún en "Borrador" (art. XII).
