# Design Document

**Spec:** `003-movement-simulation`
**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-03
**Estado:** Aprobado (2026-11-22); revisión QA RECHAZADA por B-1 — se resuelve con RC-01; refuerzo RC-01 pendiente de aprobación

## Overview

Diseño técnico de la HU-03: simulación de movimiento con decisión del vigilante. El operador
elige un destino (clic o coordenadas); el backend evalúa origen→destino contra las zonas con
`isCollision` (spec 001) y devuelve una **decisión** (`ALLOW`, `PREVENTIVE_STOP`,
`DENIED_SAFE_STOP`) y el **estado** del robot (`IDLE`, `MOVING`, `SAFE_STOP`). La interfaz
solo **renderiza la respuesta**: no evalúa reglas (constitución art. III). El estado y la
posición del robot son autoridad del backend. Alcance de estados: IDLE/MOVING/SAFE_STOP;
DEGRADED/RECOVERING quedan fuera (dependen de sensores, reservado).

> **[RC-01] Refuerzo de convergencia con el prototipo.** Esta spec deja de tener vigilante
> propio y pasa a ser la **capa de simulación y presentación**:
> - **Backend propio de la 003:** catálogo de robots (`robots`, `/api/robots`), sesiones y
>   secuencia (`robot_sessions`, `POST /api/robots/:robotId/sessions` y la validación
>   `acceptRequest` que el `move` de la 002 invoca antes del vigilante).
> - **Backend que consume (spec 002):** vigilante por robot, `recover`, lecturas de posición,
>   incidentes, `audit_log` y `state_transition_log`.
> - **Frontend:** Supervisión multi-robot, Robots simulados, Incidentes (y Zonas y reglas, de la
>   001) con la navegación del prototipo.
> - **Se retiran:** `rules/watchmanRule.ts`, `services/movementService.ts`,
>   `controllers/simulationController.ts`, `routes/simulationRoutes.ts`, `/api/simulation/*`,
>   `simulationApi`, `useSimulation` y los tipos `Decision`/`MoveResult`.
>
> Lo sustituido se conserva marcado "Sustituido por RC-01".
>
> **[RC-01 rev2]** Cambios de la revisión 2 (informe del analista, decisiones del humano del
> 2026-11-23): esquema único de `robot_sessions` y tipos `MoveCommand`/`LastRequest` (B-3);
> rechazos como **resultados tipados** que confirman su auditoría (B-5); alta con `initRobot` de la
> 002 y `409 ROBOT_START_IN_RESTRICTED_ZONE` (Q-D, M-9); posiciones de Q-E; botones "Perder
> conexión"/"Recuperar señal" (Q-B); una sola migración de la UI (Q-F); indicador de solicitudes
> desde la API (M-7); `RobotStateName` en lugar de `GuardianState`.

---

## Architecture

```
Frontend (React)                      Backend (Express)                 SQLite
┌────────────────────┐   HTTP+JSON   ┌───────────────────────────────┐  ┌───────────────┐
│ SimulationPage     │──────────────▶│ simulationController           │  │ robot_state   │
│  FloorPlan (clic)  │   POST /move  │   → movementService            │  │ (1 fila)      │
│  CoordInput        │               │       → watchmanRule (pura)    │  │ movement_log  │
│  DecisionPanel     │◀──────────────│         usa isCollision (001)  │──▶│ (append-only) │
│  useSimulation     │   decisión    │       → robotRepository        │  └───────────────┘
└────────────────────┘   + estado    └───────────────────────────────┘
        ▲                                          ▲
        └────────── @home-guardian/domain ─────────┘
          (tipos Point, Zone, Decision, RobotState, CollisionType, esquemas Zod)
```

Funcionalidad vertical (constitución art. VII): frontend → API → dominio/reglas →
persistencia. La UI nunca contiene lógica de decisión.

---

## Components and Interfaces

### 1. `@home-guardian/domain` (añadidos de esta spec)

> **Sustituido por RC-01** en lo relativo al vigilante: `Decision`, `MoveResult` y
> `RobotStateName` de 3 estados se retiran en favor de los tipos de la spec 002. Esta spec añade
> al dominio **[RC-01]**:
> ```ts
> export type RobotType = 'VACUUM' | 'GUARD';
> export interface Robot {
>   id: number; name: string; type: RobotType; createdAt: string;   // ISO-8601
>   state: RobotStateName; position: Point; positionQuality: PositionQuality; // de la 002
>   lastRequest: LastRequest | null;                                  // [RC-01 rev2]
> }
> export interface RobotInput { name: string; type: RobotType }       // el cliente no envía estado
> export interface MoveCommand { destination: Point; sessionId: string; sequence: number }
> export interface SessionInfo { sessionId: string }
> export interface LastRequest {                                       // [RC-01 rev2] (B-3)
>   sessionId: string; sequence: number; destination: Point; acceptedAt: string;
> }
> // Zod
> export const robotInputSchema = z.object({
>   name: z.string().trim().min(1).max(60),
>   type: z.enum(['VACUUM', 'GUARD']),
> }).strict();                                    // estado/posición enviados → 422 INVALID_ROBOT
> export const moveCommandSchema = z.object({
>   destination: pointSchema,
>   sessionId: z.string().uuid(),
>   sequence: z.number().int().min(1),
> });
> ```
> **[RC-01 rev2]** El tipo de estado es el existente `RobotStateName`, ampliado a 5 estados por
> la spec 002 (no existe `GuardianState`); `PositionQuality` lo define la 002. Nombres únicos para
> todas las specs (B-3): `MoveCommand` + `moveCommandSchema`, `LastRequest`, `SessionInfo`; no se
> usan `GuardedMoveRequest`, `LastAcceptedRequest` ni `newSession`. `RULES` y `ruleForDecision`
> son de la spec 001 (única definición). Tipos originales (histórico):

```ts
export type RobotStateName = 'IDLE' | 'MOVING' | 'SAFE_STOP';
export type Decision = 'ALLOW' | 'PREVENTIVE_STOP' | 'DENIED_SAFE_STOP';

export interface RobotSnapshot {
  state: RobotStateName;
  position: Point;           // Point viene de la spec 001
}

export interface MoveRequest { destination: Point; }

export interface MoveResult {
  decision: Decision;
  state: RobotStateName;
  position: Point;                 // nueva posición (ALLOW) u origen (parada/denegación)
  collisionType?: CollisionType;   // solo en PREVENTIVE_STOP
  zoneName?: string;               // zona implicada, si aplica
  code?: 'SAFE_STOP_ACTIVE';       // solo en DENIED_SAFE_STOP
  reason: string;
}
```

Esquemas Zod:
```ts
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export const moveRequestSchema = z.object({ destination: pointSchema });
```

### 2. Regla pura del vigilante — `rules/watchmanRule.ts`

> **Sustituido por RC-01.** Se retira `decideMovement`: la decisión la toma `evaluateMovement`
> de la spec 002 (que también reutiliza `isCollision`). Se conserva el texto como histórico.
>
> **[RC-01] Regla pura nueva de esta spec — `rules/sequenceRule.ts`:**
> ```ts
> // Pura y determinista. La invoca acceptRequest antes del vigilante (R8).
> export function checkSequence(input: {
>   currentSessionId: string | null;   // sesión vigente del robot (null si no hay)
>   lastSequence: number | null;       // última secuencia aceptada en esa sesión
>   sessionId: string;
>   sequence: number;
> }): { ok: true } | { ok: false; code: 'INVALID_SESSION' | 'DUPLICATE_EVENT' } {
>   // sessionId !== currentSessionId        → INVALID_SESSION
>   // lastSequence !== null && sequence <= lastSequence → DUPLICATE_EVENT
>   // en otro caso                          → ok
> }
> ```
> **[RC-01 rev2]** Con el esquema único, `last_sequence` es `NOT NULL DEFAULT 0`: la regla recibe
> `lastSequence: number` (0 = sin solicitudes) y rechaza `sequence <= lastSequence`.

Función pura, sin efectos secundarios (constitución art. V; SOLID-O: nuevas reglas no
modifican esta firma). Decide a partir de estado, origen, destino y zonas activas.

```ts
export function decideMovement(input: {
  state: RobotStateName;
  origin: Point;
  destination: Point;
  activeZones: Zone[];
  pad?: number;              // por defecto COLLISION_PAD (spec 001)
}): MoveResult {
  // 1. Si state === 'SAFE_STOP' → DENIED_SAFE_STOP (code SAFE_STOP_ACTIVE), no se mueve.
  // 2. Para cada zona activa, evaluar isCollision(zone, {from:origin,to:destination}, pad).
  //    Prioridad de colisión definida por isCollision (origen > destino > trayectoria).
  //    Si alguna colisiona → PREVENTIVE_STOP, state SAFE_STOP, position = origin,
  //      collisionType y zoneName de la primera colisión encontrada.
  // 3. Si ninguna colisiona → ALLOW, state MOVING, position = destination.
}
```
> Determinismo (RNF-06): salida función de las entradas. La validación de límites del plano
> (destino dentro) se hace antes, en el servicio, para emitir `DESTINATION_OUT_OF_BOUNDS`.

### 3. Backend

> **[RC-01] Backend vigente de esta spec** (el árbol original de abajo queda como histórico; sus
> archivos de vigilante se retiran):
> ```
> packages/backend/src/
> ├── controllers/robotsController.ts       # GET/POST /api/robots, GET /api/robots/:robotId,
> │                                         #   POST /api/robots/:robotId/sessions
> ├── services/robotCatalogService.ts        # registrar/listar robots; el estado inicial lo crea
> │                                         #   `guardianService.initRobot` (spec 002, DD-220)
> ├── services/sessionService.ts             # startSession(robotId), acceptRequest(robotId, cmd) [RC-01 rev2]
> ├── rules/sequenceRule.ts                  # checkSequence (pura)
> ├── repositories/robotCatalogRepository.ts # tabla robots
> ├── repositories/sessionRepository.ts      # tabla robot_sessions
> └── routes/robotsRoutes.ts                 # /api/robots (monta además las subrutas por robot
>                                            #   del vigilante que define la spec 002)
> ```
> - `acceptRequest(robotId, { sessionId, sequence, destination })` lee la sesión vigente, llama
>   a `checkSequence` y, si es válida, registra la solicitud como última aceptada.
>   **[RC-01 rev2] (B-5)** Devuelve un **resultado tipado**:
>   `{ kind: 'accepted' } | { kind: 'rejected'; code: 'INVALID_SESSION' | 'DUPLICATE_EVENT' }`,
>   **sin lanzar excepciones**. El `move` de la spec 002 la invoca dentro de su transacción, antes
>   de `evaluateMovement`; ante un rechazo escribe la fila de `audit_log`, **confirma** la
>   transacción y el controller responde `409 { code, message }`. No crea incidente ni transición.
>   (El texto anterior "lanza `AppError(409, …)`" queda **sustituido por RC-01 rev2**: con
>   `db.transaction`, la excepción revertía también la auditoría.)
> - `startSession(robotId)` (`POST /api/robots/:robotId/sessions`): genera un UUID, sustituye la
>   fila de `robot_sessions` del robot (`last_sequence = 0`, `last_*` a `NULL`) y responde
>   `201 { sessionId }`.
> - **[RC-01 rev2] Alta de un robot (M-9, Q-D, I-6):** en **una** transacción
>   `IMMEDIATE`, `robotCatalogService.register(input)`:
>   1. valida que (120, 90) no cae en ninguna zona **activa** expandida por r + m (geometría pura
>      de la spec 001, `isCollision` con segmento degenerado). Si cae →
>      `{ kind: 'rejected', code: 'ROBOT_START_IN_RESTRICTED_ZONE' }`, fila en `audit_log`,
>      transacción confirmada, `409` (no se crea nada);
>   2. inserta la fila de `robots`;
>   3. invoca `guardianService.initRobot(robotId, { x: 120, y: 90 })` (spec 002), que crea la fila
>      de `robot_state` con un `INSERT` simple (falla si existe) y registra la transición inicial.
>   El catálogo **no** escribe `robot_state`. (Sustituye a "usando la API del repositorio de
>   estado de la spec 002".)
> - Robot inexistente → `404 ROBOT_NOT_FOUND`; validación → `422 INVALID_ROBOT`; nombre
>   repetido (UNIQUE) → `409 ROBOT_NAME_DUPLICATE`.
> - Las rutas de esta spec se prueban primero con una app de prueba que monta solo
>   `robotsRoutes`; el montaje en `app.ts` se hace en el paso 5 de U1, junto a la retirada del
>   vigilante provisional (tasks).

```
packages/backend/src/
├── controllers/simulationController.ts  # solo recibe/responde
├── services/movementService.ts          # orquesta: valida límites, lee zonas y robot,
│                                         #   llama a decideMovement, persiste estado + log
├── repositories/robotRepository.ts       # estado/posición del robot (1 fila)
├── repositories/movementLogRepository.ts # registro append-only de decisiones
├── rules/watchmanRule.ts                  # decideMovement (puro)
├── routes/simulationRoutes.ts             # /api/simulation
└── schemas/simulation.schema.ts           # moveRequestSchema
packages/backend/migrations/
├── 00X_create_robot_state.sql
└── 00Y_create_movement_log.sql
```

#### Contrato de capas (SOLID)
- **Controller (S):** parsea request (Zod), llama al servicio, mapea decisión a HTTP.
- **Service (D):** recibe `robotRepository`, `movementLogRepository` y la lista de zonas por
  parámetro/inyección manual; valida límites del plano; invoca `decideMovement`; persiste.
- **Rule (O):** `decideMovement` puro; añadir reglas futuras sin tocar la firma.
- **Repository:** acceso SQLite parametrizado (better-sqlite3, sin ORM).

#### Mapeo decisión → HTTP (controller)
| Decisión | HTTP | Cuerpo |
|----------|------|--------|
| `ALLOW` | 200 | `MoveResult` (state MOVING→IDLE, nueva posición) |
| `PREVENTIVE_STOP` | 200 | `MoveResult` (state SAFE_STOP, origen, collisionType, zoneName) |
| `DENIED_SAFE_STOP` | 409 | `MoveResult` con `code: SAFE_STOP_ACTIVE` |
| destino fuera de plano | 422 | `{ code: 'DESTINATION_OUT_OF_BOUNDS', message }` |
| payload inválido | 422 | `{ code: 'INVALID_DESTINATION', message }` |

#### Validación de límites (servicio)
```ts
function assertWithinFloor(p: Point) {
  if (p.x < 0 || p.y < 0 || p.x > FLOOR_WIDTH || p.y > FLOOR_HEIGHT)
    throw new AppError(422, 'DESTINATION_OUT_OF_BOUNDS', 'Destination outside floor');
}
// Borde inclusivo: x=0, x=FLOOR_WIDTH, y=0, y=FLOOR_HEIGHT son válidos
// (se usan comparaciones estrictas < y >, por lo que el borde se acepta).
```

#### Transición y persistencia de estado
- `ALLOW`: posición ← destino; estado MOVING y, al completar la simulación (inmediata en
  este prototipo), IDLE. Se persiste la posición final y estado IDLE.
- `PREVENTIVE_STOP`: posición sin cambios; estado SAFE_STOP persistido.
- `DENIED_SAFE_STOP`: sin cambios de estado ni posición.
- `reset`: estado ← IDLE (posición conservada); único camino de salida de SAFE_STOP en alcance.

### 4. Frontend

> **[RC-01] Frontend vigente** (el árbol original de abajo queda como histórico):
> ```
> packages/frontend/src/
> ├── App.tsx                          # barra lateral: Supervisión · Robots simulados ·
> │                                    #   Zonas y reglas · Incidentes (hash #/supervision,
> │                                    #   #/robots, #/zonas, #/incidentes)
> ├── pages/SimulationPage.tsx         # Supervisión: selector de robot, indicadores, plano,
> │                                    #   coordenadas, "Enviar a escaleras", "Nueva sesión",
> │                                    #   "Liberar parada", DecisionPanel, TelemetryPanel
> ├── pages/RobotsPage.tsx             # tarjetas de robots + modal "Registrar robot"
> ├── pages/IncidentsPage.tsx          # bitácora + detalle; HU-06/HU-07 deshabilitados
> ├── components/FloorPlan.tsx         # dibuja N robots (color por estado/tipo) y captura clic
> ├── components/CoordInput.tsx        # sin cambios de contrato (emite Point)
> ├── components/DecisionPanel.tsx     # AUTHORIZED / DENIED / REJECTED tal como llegan
> ├── components/TelemetryPanel.tsx    # JSON de la última solicitud y respuesta
> ├── components/RobotCard.tsx, RegisterRobotModal.tsx, IncidentTable.tsx, IncidentDetail.tsx
> ├── hooks/useRobots.ts               # lista + registro (carga/error por operación)
> ├── hooks/useRobot.ts                # estado, move (con sesión y secuencia), recover, startSession,
> │                                    #   loseSignal, restoreSignal [RC-01 rev2]
> ├── hooks/useIncidents.ts            # lista + detalle
> └── api/client.ts                    # robotsApi, incidentsApi (sustituyen a simulationApi)
> ```
> - `useRobot` guarda `sessionId` y el contador `sequence` por robot en memoria; al cambiar de
>   sesión reinicia el contador a 1. La UI nunca decide: si la API responde
>   `409 DUPLICATE_EVENT` o `INVALID_SESSION`, lo muestra tal cual.
> - Un `409` de `move` con cuerpo de decisión (`REJECTED`) se trata como decisión que se muestra;
>   los `409` con `{ code, message }` (`INVALID_SESSION`, `DUPLICATE_EVENT`,
>   `RECOVERY_NOT_ALLOWED` con `cause`) se muestran como aviso.
> - Indicadores de Supervisión: robots activos (`GET /api/robots`, estado distinto de
>   `SAFE_STOP`/`DEGRADED`), paradas (`GET /api/incidents`, total), solicitudes procesadas y zonas
>   restringidas (`GET /api/zones`). Todos derivan de datos de la API.
>   **[RC-01 rev2] (M-7)** "Solicitudes procesadas" = `lastRequest.sequence` del robot
>   seleccionado (0 si es `null`); se elimina el "contador de la sesión de la UI", que
>   contradecía DD-114.
> - **[RC-01 rev2] (Q-B)** "⌁ Perder conexión" → `POST /api/robots/:robotId/position`
>   `{ quality: 'MISSING' }`; "↻ Recuperar señal" → `{ quality: 'RELIABLE', position }` con la
>   `position` del último `GET .../state` del robot (no se calcula en la UI). Ambos muestran la
>   respuesta tal cual (`POSITION_CONFLICT` incluido) y refrescan estado e incidentes.
> - **[RC-01 rev2] (Q-F)** La UI migra **una sola vez**: de `simulationApi` a `robotsApi` contra
>   `/api/robots/:robotId/*`. No hay etapa intermedia con `/api/robot` singular.
> - "Enviar a escaleras": busca en `GET /api/zones` la zona "Escaleras"; si está activa, usa su
>   centro como destino y llama a `move`; si no, avisa ("Escaleras está permitida; restrínjala
>   antes de probar la parada", como el prototipo). No evalúa colisiones.
> - Colores del robot: `VACUUM` activo `#3176d2`, `GUARD` activo `#665dd3`, `SAFE_STOP` `#bd4954`,
>   `DEGRADED` `#8893a2`, `RECOVERING`/`MOVING` como activo.

```
packages/frontend/src/
├── pages/SimulationPage.tsx        # HU-03
├── components/FloorPlan.tsx        # reutiliza plano spec 001; captura clic → destino
├── components/CoordInput.tsx       # entrada de coordenadas (x,y)
├── components/DecisionPanel.tsx    # muestra decisión + estado + razón (solo lectura)
├── hooks/useSimulation.ts          # fetching estado + move + reset; carga/error
└── api/client.ts                   # simulationApi
```

- `simulationApi.getRobot()`, `simulationApi.move(destination)`, `simulationApi.reset()`.
- `FloorPlan` emite un destino al hacer clic (convierte coords de viewport a coords de plano);
  `CoordInput` emite el mismo tipo `Point` (RF-01.3/CA-03.7).
- `DecisionPanel` renderiza **exactamente** lo que devuelve la API: nunca recalcula colisión
  (CA-03.6). Para `PREVENTIVE_STOP` muestra la parada preventiva + `zoneName`; para
  `DENIED_SAFE_STOP` muestra `SAFE_STOP_ACTIVE`.
- La posición del robot en el plano se toma del `GET /robot` y de la respuesta de `move`.

---

## Data Models

### [RC-01] Tabla `robots` (catálogo; propietaria esta spec)
```sql
CREATE TABLE IF NOT EXISTS robots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 60),
  type       TEXT    NOT NULL CHECK (type IN ('VACUUM', 'GUARD')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```
Seed (base nueva): `Aspiradora A1` (`VACUUM`, (160, 123)) y `Vigilante V2` (`GUARD`, (488, 290)).
La fila 1 actual de `robot_state` se asocia a `Aspiradora A1`; la conversión de `robot_state` a
una fila por robot (`robot_id` PK/FK) la diseña la spec 002.

> **[RC-01 rev2] Migración `007_create_robots.sql` (paso 2 de U1, primera del bloque):** crea
> `robots` e inserta A1 (id = 1) y V2 (id = 2). Las posiciones (Q-E) no viven en `robots`: las
> fija la migración `008` de la spec 002 al crear `robot_state` por robot — en base nueva A1 en
> (160, 123) y V2 en (488, 290); en base existente A1 conserva la fila actual. Sin `UPDATE`
> encubiertos. Los robots registrados después empiezan en (120, 90) vía `initRobot`.

### [RC-01] Tabla `robot_sessions` (propietaria esta spec)
> **[RC-01 rev2] Esquema único (B-3), migración `012_create_robot_sessions.sql`** (paso 2 de U1,
> tras las 008–011 de la spec 002). Es la única definición: la spec 002 la cita sin copiarla.
> ```sql
> CREATE TABLE IF NOT EXISTS robot_sessions (
>   robot_id           INTEGER PRIMARY KEY REFERENCES robots(id),
>   session_id         TEXT    NOT NULL UNIQUE,   -- sesión vigente (UUID)
>   last_sequence      INTEGER NOT NULL DEFAULT 0, -- 0 = sin solicitudes aceptadas
>   last_destination_x REAL,
>   last_destination_y REAL,
>   last_accepted_at   TEXT,                      -- ISO-8601 UTC
>   started_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
> );
> ```
> `LastRequest` se construye desde `session_id`, `last_sequence`, `last_destination_*` y
> `last_accepted_at` (`null` si `last_sequence = 0`). Esquema anterior (sustituido por RC-01 rev2):

```sql
CREATE TABLE IF NOT EXISTS robot_sessions (
  robot_id      INTEGER PRIMARY KEY REFERENCES robots(id),
  session_id    TEXT    NOT NULL,          -- sesión vigente (UUID)
  last_sequence INTEGER,                   -- null hasta la primera solicitud aceptada
  last_dest_x   REAL,
  last_dest_y   REAL,
  last_at       TEXT,                      -- fecha de la última solicitud aceptada
  started_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```
Una fila por robot: "Nueva sesión" reemplaza `session_id` y anula `last_*` (es estado vigente,
no un registro; la auditoría de rechazos va a `audit_log` de la 002). **[RC-01 rev2]** La
numeración es la del orden real de entrega de U1: `007` (esta spec) → `008`–`011` (spec 002) →
`012` (esta spec); `013` (spec 001) va en U2.

### Tabla `robot_state` (fila única, estado actual)

> **Sustituido por RC-01:** pasa a una fila por robot y su diseño pertenece a la spec 002.
```sql
CREATE TABLE IF NOT EXISTS robot_state (
  id        INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
  state     TEXT    NOT NULL DEFAULT 'IDLE',     -- IDLE | MOVING | SAFE_STOP
  pos_x     REAL    NOT NULL DEFAULT 0,
  pos_y     REAL    NOT NULL DEFAULT 0,
  updated_at TEXT   NOT NULL DEFAULT (datetime('now'))
);
```

### Tabla `movement_log` (append-only, registro de decisiones)

> **[RC-01]** Se conserva como **histórico inmutable**: deja de recibir filas al retirarse el
> vigilante provisional. Los registros vigentes son los de la spec 002.
```sql
CREATE TABLE IF NOT EXISTS movement_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  decision       TEXT    NOT NULL,   -- ALLOW | PREVENTIVE_STOP | DENIED_SAFE_STOP
  state_after    TEXT    NOT NULL,
  origin_x       REAL    NOT NULL,
  origin_y       REAL    NOT NULL,
  dest_x         REAL    NOT NULL,
  dest_y         REAL    NOT NULL,
  collision_type TEXT,               -- nullable
  zone_name      TEXT,               -- nullable
  reason         TEXT    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
```
> `movement_log` solo admite inserciones (RF-05.1; registro inmutable alineado con la regla
> de incidentes del steering de seguridad). Migraciones SQL versionadas (spec 001, DD-005).

---

## Error Handling

> **[RC-01]** Errores nuevos de esta spec: `422 INVALID_ROBOT`, `409 ROBOT_NAME_DUPLICATE`,
> `404 ROBOT_NOT_FOUND`, `409 INVALID_SESSION`, `409 DUPLICATE_EVENT`, todos con
> `{ code, message }` sin stack trace. `DENIED_SAFE_STOP`/`PREVENTIVE_STOP` quedan sustituidos
> por el mapeo de la spec 002 (`DENIED` 200, `REJECTED` 409).
>
> **[RC-01 rev2] (B-5, M-5)** Se añaden `409 ROBOT_START_IN_RESTRICTED_ZONE` y
> `422 INVALID_MOVE_REQUEST`. Regla: **solo** la validación de entrada (`422`), los
> `404 ROBOT_NOT_FOUND` y los fallos internos (`500`) usan `AppError`. Los rechazos que se
> auditan (`INVALID_SESSION`, `DUPLICATE_EVENT`, `ROBOT_START_IN_RESTRICTED_ZONE`) son
> resultados tipados del servicio: la transacción se confirma con la fila de `audit_log` y el
> controller traduce a `409 { code, message }`.

- `AppError(status, code, message)` reutilizado del patrón de la spec 001.
- `errorHandler` traduce `AppError` a `{ code, message }` con el status; no controlado → 500
  genérico sin stack trace (RNF-04).
- `DENIED_SAFE_STOP` se devuelve con `409` y cuerpo `MoveResult` (incluye `code`), de modo que
  la UI pueda mostrar `SAFE_STOP_ACTIVE` con el estado y la posición.
- `PREVENTIVE_STOP` **no** es error: `200` con la decisión en el cuerpo.

---

## Correctness Properties

### Property 1: Fallo seguro por colisión
Si existe al menos una zona activa que colisiona con el segmento origen→destino, entonces la
decisión es `PREVENTIVE_STOP`, el estado resultante es `SAFE_STOP` y la posición no cambia.

**Validates: Requirements 3.2, 3.3** (RF-03.2; CA-03.2, CA-03.3)

### Property 2: Avance solo cuando está libre
La decisión es `ALLOW` y la posición pasa a ser el destino si y solo si ninguna zona activa
colisiona con el segmento y el estado previo no es `SAFE_STOP`.

**Validates: Requirements 3.1** (RF-03.1; CA-03.1)

### Property 3: SAFE_STOP absorbe
Si el estado previo es `SAFE_STOP`, toda solicitud de movimiento devuelve `DENIED_SAFE_STOP`
(`SAFE_STOP_ACTIVE`) sin cambiar estado ni posición.

**Validates: Requirements 3.3** (RF-03.3; CA-03.4)

### Property 4: La UI no decide
Para una misma respuesta de la API, la representación de la UI (decisión, estado, posición)
es función de esa respuesta y no de una reevaluación de reglas en el cliente.

**Validates: Requirements 4.1** (RF-04.1; CA-03.6)

### Property 5: Determinismo
Dadas las mismas entradas (estado, origen, destino, zonas activas, pad), `decideMovement`
produce siempre la misma `MoveResult`.

**Validates: Requirements 4.6** (RNF-06)

### Property 6: Equivalencia clic/coordenadas
Un destino fijado por clic y el mismo destino escrito en coordenadas producen la misma
solicitud y, con el mismo estado y zonas, la misma decisión.

**Validates: Requirements 1.1, 1.2, 1.3** (RF-01; CA-03.7)

> **[RC-01]** Las Properties 1–3 y 5 quedan **sustituidas por RC-01** (las garantiza el
> vigilante de la spec 002). Las Properties 4 y 6 se mantienen.

### Property 7 [RC-01]: Un duplicado nunca produce una decisión
Para toda solicitud con `sequence` menor o igual que la última aceptada de la sesión vigente, la
respuesta es `409 DUPLICATE_EVENT` y no cambian el estado, la posición ni los incidentes.

**Validates: Requirements 8.3, 8.4** (CA-03.11, CA-03.12)

### Property 8 [RC-01]: El estado inicial lo asigna el backend
Todo robot recién registrado está en `IDLE`, `RELIABLE` y (120, 90), sea cual sea el cuerpo
enviado; un cuerpo con estado o posición se rechaza con `422 INVALID_ROBOT`.
**[RC-01 rev2]** Si (120, 90) cae en una zona activa, no se crea ni el robot ni su estado
(`409 ROBOT_START_IN_RESTRICTED_ZONE`, auditado); el estado lo crea siempre `initRobot`.

**Validates: Requirements 7.2, 7.4, 7.9** (CA-03.9, CA-03.10, CA-03.22)

### Property 9 [RC-01]: Un solo vigilante
Ninguna ruta fuera de `/api/robots/:robotId/move|recover|position` (spec 002) y del registro de
robots cambia `robot_state`; `/api/simulation/*` responde `404`.
**[RC-01 rev2]** El registro de robots cambia `robot_state` solo a través de
`guardianService.initRobot`; las migraciones son escritoras autorizadas únicamente al desplegar
el esquema (spec 002, Q-H).

**Validates: Requirements 11.1, 11.4** (CA-03.17)

### Property 10 [RC-01]: La UI no decide (ampliada)
Para cualquier respuesta de `/api/robots/*` o `/api/incidents/*`, lo que muestra la UI (decisión,
estado, color, causa, incidente) es función de la respuesta, sin reevaluar reglas.

**Validates: Requirements 4.6, 9.5, 2.3** (CA-03.6)

### Property 11 [RC-01 rev2]: Todo rechazo auditado persiste
Para toda respuesta `409 INVALID_SESSION`, `409 DUPLICATE_EVENT` o
`409 ROBOT_START_IN_RESTRICTED_ZONE`, existe después de la respuesta exactamente una fila nueva en
`audit_log` con ese código, y no cambian `robot_state`, `robots`, `robot_sessions` (salvo el
propio rechazo) ni los incidentes.

**Validates: Requirements 7.9, 8.4, 8.8** (CA-03.22, CA-03.25)

### Property 12 [RC-01 rev2]: Las señales las decide el backend
Lo que la UI muestra tras "Perder conexión" o "Recuperar señal" (estado, calidad, incidente) es
función de las respuestas de la API; la posición enviada en "Recuperar señal" es la última
devuelta por la API para ese robot.

**Validates: Requirements 10.6, 10.7, 4.6** (CA-03.31, CA-03.32)

---

## Testing Strategy

| Nivel | Objetivo | Casos |
|-------|----------|-------|
| Unit (rules) | `decideMovement` | ALLOW, PREVENTIVE_STOP (destino en zona), PREVENTIVE_STOP (trayectoria), DENIED desde SAFE_STOP, determinismo |
| Unit (service) | límites del plano | 422 DESTINATION_OUT_OF_BOUNDS, persistencia de estado y log |
| Integración (Supertest) | `/api/simulation` | GET robot, POST move 200/409/422, POST reset, movement_log append |
| Componentes (RTL) | DecisionPanel/CoordInput | renderiza decisión/estado sin recalcular; clic==coords |
| E2E (Playwright) | humo | clic en zona → parada preventiva visible; reset → IDLE |

> **[RC-01] Estrategia vigente:**
>
> | Nivel | Objetivo | Casos |
> |-------|----------|-------|
> | Unit (rules) | `checkSequence` | sesión vigente/ajena/nula, secuencia mayor/igual/menor, primera solicitud |
> | Unit (service) | `robotCatalogService`, `sessionService` | estado inicial asignado, nombre 1–60 y duplicado, nueva sesión invalida la anterior, última solicitud persistida |
> | Integración (Supertest) | `/api/robots`, sesiones, `move` con sesión | 201/422/409/404, `INVALID_SESSION`, `DUPLICATE_EVENT` sin incidente y auditado, `/api/simulation/*` → 404 |
> | Componentes (RTL) | páginas y componentes nuevos | DecisionPanel con AUTHORIZED/DENIED/REJECTED sin código inventado; RobotsPage + modal; IncidentsPage tabla/detalle/vacío y botones HU-06/07 deshabilitados; TelemetryPanel muestra el JSON tal cual; recover con `transitioned` y con `cause`; selector de robot; "Enviar a escaleras" con zona activa e inactiva; escaneo estático: la UI no importa reglas |
> | E2E (Playwright) | flujos del prototipo | registrar robot → aparece en el plano; clic en zona → DENIED y el incidente aparece en "Incidentes"; nuevo movimiento → REJECTED; recover → IDLE; recover rechazado con UNSAFE_POSITION; sesión duplicada → DUPLICATE_EVENT |
>
> **[RC-01 rev2] Añadidos:** prueba por cada `409` auditado que lee `audit_log` después de la
> respuesta (Property 11); alta con la zona "Sala" activa → `409 ROBOT_START_IN_RESTRICTED_ZONE`
> sin filas nuevas en `robots`/`robot_state`; posiciones de la semilla en base nueva y conservación
> en base existente (con la 008 de la 002); `checkSequence` con `lastSequence = 0`; RTL y E2E de
> "Perder conexión" (DEGRADED + incidente `R-SIGNAL-01`) y "Recuperar señal" + "Liberar parada";
> indicador "Solicitudes procesadas" desde `lastRequest.sequence`. Las rutas de esta spec se prueban
> primero con una app de prueba sin montar en `app.ts`.

---

## Decisiones de diseño

| ID | Decisión | Alternativa descartada | Justificación |
|----|----------|------------------------|---------------|
| DD-101 | `PREVENTIVE_STOP` responde 200 con decisión en cuerpo | 4xx para la parada | Es una decisión válida del vigilante, no un error de transporte |
| DD-102 | `DENIED_SAFE_STOP` responde 409 | 200 con flag | La solicitud es inválida respecto al estado actual |
| DD-103 | Estado/posición del robot en backend (singleton) | Estado en el cliente | El vigilante y la verdad del estado no dependen del frontend (art. III) |
| DD-104 | `decideMovement` puro reutiliza `isCollision` (spec 001) | Reimplementar colisión | Fuente única del modelo geométrico; sin duplicación |
| DD-105 | `movement_log` append-only | Log mutable | Registro inmutable de decisiones (trazabilidad art. VI) |
| DD-106 | `reset` como única salida de SAFE_STOP en alcance | Recuperación automática | Recuperación real depende de sensores (reservado) |
| DD-107 | Validar límites del plano en el servicio, no en la regla | Dentro de decideMovement | Permite `code` HTTP específico y mantiene la regla pura |
| DD-108 [RC-01] | La UI consume el vigilante de la 002; se retira el de esta spec | Mantener dos vigilantes | Un solo camino al estado (art. III); cierra B-1 |
| DD-109 [RC-01] | `recover` validado sustituye a `reset` (sustituye DD-106) | Mantener `reset` | Salida de la parada validada y registrada (art. IV) |
| DD-110 [RC-01] | Catálogo `robots` en esta spec; estado por robot en la 002 | Todo en la 002 | El catálogo es de la simulación; la autoridad del estado sigue en el vigilante |
| DD-111 [RC-01] | `robot_sessions` con una fila por robot (estado vigente) | Tabla de eventos de sesión | YAGNI: basta la última secuencia; la auditoría está en `audit_log` |
| DD-112 [RC-01] | `checkSequence` pura, invocada por el `move` de la 002 antes del vigilante | Validar en el controller | Determinista y probable sin BD; atómica con la decisión |
| DD-113 [RC-01] | La UI lleva la secuencia automáticamente por sesión | El operador la escribe | Evita errores de uso; los duplicados solo surgen por reintentos |
| DD-114 [RC-01] | Indicadores derivados de datos de la API | Contadores locales en el navegador | La UI no inventa estado (art. III) |
| DD-115 [RC-01] | "Enviar a escaleras" usa el centro de la zona leída de la API | Coordenadas fijas | No acopla la UI a la geometría del seed |
| DD-116 [RC-01 rev2] | Una sola migración de la UI, directa a `/api/robots/:robotId/*` (Q-F) | Etapa intermedia `/api/robot` | Elimina el ciclo del plan (B-1) y la tarea huérfana (B-2) |
| DD-117 [RC-01 rev2] | Rechazos auditados como resultados tipados (B-5) | `AppError(409)` dentro de la transacción | La excepción revertía la fila de `audit_log` |
| DD-118 [RC-01 rev2] | Alta en zona activa → `409 ROBOT_START_IN_RESTRICTED_ZONE` (Q-D) | Aceptar `IDLE` o iniciar en `SAFE_STOP` | Fallo seguro sin estados iniciales anómalos; el operador elige otra configuración |
| DD-119 [RC-01 rev2] | Semilla A1 (160, 123) y V2 (488, 290) en base nueva; base existente conserva A1; nuevos en (120, 90) (Q-E) | Una única posición para todo | Fiel al prototipo sin reescribir el estado existente |
| DD-120 [RC-01 rev2] | "Perder conexión"/"Recuperar señal" en la UI (Q-B) | Mantenerlo reservado | Es la señal explícita ya en alcance en la 002; la inyección de fallos de sensor sigue reservada |
| DD-121 [RC-01 rev2] | "Solicitudes procesadas" = `lastRequest.sequence` de la API (M-7) | Contador local | Corrige la contradicción con DD-114 |
| DD-122 [RC-01 rev2] | Esquema único de `robot_sessions` y tipos `MoveCommand`/`LastRequest` (B-3) | Definiciones en 002 y 003 | Una sola fuente de verdad |
| DD-123 [RC-01 rev2] | Autenticación como riesgo aceptado (Q-A) | Implementarla ahora | Decisión del humano; se aborda en un bloque posterior |

---

## Dependencias entre HU
- HU-03 depende de la spec `001-restricted-zones` (geometría, `isCollision`, `Zone`) y de la
  spec del vigilante (mapeo colisión→decisión). Reutiliza el `FloorPlan` de la spec 001.
- Estados `DEGRADED`/`RECOVERING` e inyección de fallos de sensor quedan fuera (reservado).
- **[RC-01]** Depende de la spec 002 para: rutas por robot del vigilante, `robot_state` con una
  fila por robot y su API de escritura (para el estado inicial), incidentes con `robot_id` y
  `rule`, `audit_log` (rechazos de sesión) y la invocación de `acceptRequest` dentro de `move`.
  Depende de la spec 001 para el catálogo `RULES`. Los estados `DEGRADED`/`RECOVERING` se
  **muestran**; la inyección de fallos sigue reservada (pregunta Q-B de requirements).
- **[RC-01 rev2]** Dependencias concretas (sin ciclos, en el orden de la unidad U1): `RULES` y
  `ruleForDecision` de la 001 (paso 1); migraciones `008`–`011` de la 002 entre las `007` y `012`
  de esta spec (paso 2); `guardianService.initRobot`, `move` con `acceptRequest`, `recover`,
  `position` e incidentes con `robot_id`, `rule` y `zone_name` de la 002 (paso 3); montaje
  conjunto en `app.ts` y retirada del vigilante provisional (paso 5). La pérdida de señal sale de
  lo reservado (DD-120).

---

## Compuerta Fase 2 (DISEÑAR)
- [x] El humano aprueba explícitamente este `design.md`. (2026-11-22)
- [x] Se confirma el mapeo decisión→HTTP (DD-101/DD-102). (aprobado junto con el design)
- [x] Se confirma `reset` como salida de SAFE_STOP para la demo (DD-106). (aprobado junto con el design)

## Compuerta RC-01 (pendiente)
- [ ] El humano aprueba el refuerzo RC-01 de este `design.md` (DD-108..DD-115).
- [ ] Se confirma la retirada de `reset` (DD-109) y del vigilante provisional (DD-108).
- [ ] Se resuelven las preguntas Q-A, Q-B y Q-C de requirements §11. **[RC-01 rev2]** Resueltas por el humano el 2026-11-23 (ver requirements §11).
- [ ] **[RC-01 rev2]** El analista revisa la revisión 2 (DD-116..DD-123) y el humano aprueba el RC-01.
