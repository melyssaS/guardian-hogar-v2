# Design Document

**Spec:** `003-movement-simulation`
**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-03
**Estado:** Borrador — pendiente de aprobación humana (compuerta Fase 2)

## Overview

Diseño técnico de la HU-03: simulación de movimiento con decisión del vigilante. El operador
elige un destino (clic o coordenadas); el backend evalúa origen→destino contra las zonas con
`isCollision` (spec 001) y devuelve una **decisión** (`ALLOW`, `PREVENTIVE_STOP`,
`DENIED_SAFE_STOP`) y el **estado** del robot (`IDLE`, `MOVING`, `SAFE_STOP`). La interfaz
solo **renderiza la respuesta**: no evalúa reglas (constitución art. III). El estado y la
posición del robot son autoridad del backend. Alcance de estados: IDLE/MOVING/SAFE_STOP;
DEGRADED/RECOVERING quedan fuera (dependen de sensores, reservado).

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

### Tabla `robot_state` (fila única, estado actual)
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

---

## Testing Strategy

| Nivel | Objetivo | Casos |
|-------|----------|-------|
| Unit (rules) | `decideMovement` | ALLOW, PREVENTIVE_STOP (destino en zona), PREVENTIVE_STOP (trayectoria), DENIED desde SAFE_STOP, determinismo |
| Unit (service) | límites del plano | 422 DESTINATION_OUT_OF_BOUNDS, persistencia de estado y log |
| Integración (Supertest) | `/api/simulation` | GET robot, POST move 200/409/422, POST reset, movement_log append |
| Componentes (RTL) | DecisionPanel/CoordInput | renderiza decisión/estado sin recalcular; clic==coords |
| E2E (Playwright) | humo | clic en zona → parada preventiva visible; reset → IDLE |

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

---

## Dependencias entre HU
- HU-03 depende de la spec `001-restricted-zones` (geometría, `isCollision`, `Zone`) y de la
  spec del vigilante (mapeo colisión→decisión). Reutiliza el `FloorPlan` de la spec 001.
- Estados `DEGRADED`/`RECOVERING` e inyección de fallos de sensor quedan fuera (reservado).

---

## Compuerta Fase 2 (DISEÑAR)
- [ ] El humano aprueba explícitamente este `design.md`.
- [ ] Se confirma el mapeo decisión→HTTP (DD-101/DD-102).
- [ ] Se confirma `reset` como salida de SAFE_STOP para la demo (DD-106).
