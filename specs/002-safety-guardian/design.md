# Design Document

**Spec:** `002-safety-guardian`
**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-04, HU-05
**Estado:** Borrador — pendiente de aprobación humana (compuerta Fase 2)

## Overview

Diseño técnico del vigilante de seguridad (HU-04, HU-05). El núcleo es una **regla pura**
`evaluateMovement` que decide con un **orden estricto** (estado → calidad de datos → fallo de
repositorio → geometría → autorización) y una **máquina de estados** con transiciones
prohibidas. La geometría se delega a `isCollision`/`CollisionType` de la spec 001 (sin
recálculo). Toda denegación conduce a parada preventiva y crea un **incidente inmutable**; la
recuperación es explícita y validada. El reinicio seguro (ADR-10) degrada un `MOVING`
persistido a `SAFE_STOP` y arranca con `positionQuality = MISSING`. La prueba **T-12** (28
escenarios) ejercita la decisión con dobles de repositorio, sin frontend ni BD real.

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
```

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
  // 8. AUTHORIZED → nextState MOVING
}
```
> Pura y determinista (R7.3): salida función de las entradas. No persiste ni registra; eso lo
> hace el servicio. Ejecutable con zonas en memoria (T-12), sin BD.

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
```

### 4. Servicio — `services/guardianService.ts`
Orquesta (SOLID-D, inyección manual de repositorios):
1. Lee snapshot del robot (`state`, `position`, `positionQuality`) de `robotRepository`.
2. Carga zonas activas de `zoneRepository`; si lanza, pasa `zones = null`.
3. Llama a `evaluateMovement`.
4. Aplica la transición con `applyDecision`/`canTransition` y persiste el nuevo estado.
5. **Registra la evaluación** (siempre) con `collisionType`/causa y **snapshot de zonas**.
6. Si la decisión es una **denegación que para** (no un mero rechazo por estado), **crea un
   incidente** y devuelve su `incidentId`.
7. Si la solicitud se **rechaza por estado** (`SAFE_STOP_ACTIVE`/`BUSY`), registra el rechazo
   en el **log de auditoría** (tabla `audit_log`) sin crear incidente (R5.3).

### 5. Recuperación — `POST /api/robot/recover`
```ts
// Precondiciones (R4): estado en {SAFE_STOP, DEGRADED}; posición SEGURA (fuera de toda zona)
// y positionQuality === 'RELIABLE'. Cumplidas → RECOVERING → IDLE. Si no → rechazo, sin cambio.
// Fuera de parada → idempotente/rechazo sin efectos (R4.3).
```

### 6. Reinicio seguro (ADR-10) — `db/bootstrap.ts`
Al arrancar: `positionQuality = MISSING`; si el estado persistido es `MOVING` → `SAFE_STOP`.

### 7. Controllers y rutas
```
packages/backend/src/
├── controllers/robotController.ts      # state, move, recover
├── controllers/incidentController.ts   # list incidents
├── services/guardianService.ts
├── rules/guardian.ts                   # evaluateMovement (pura)
├── rules/stateMachine.ts               # transiciones + prohibiciones
├── repositories/robotRepository.ts
├── repositories/incidentRepository.ts  # append-only
├── routes/robotRoutes.ts               # /api/robot/*
├── routes/incidentRoutes.ts            # /api/incidents
├── schemas/robot.schema.ts             # moveSchema
└── db/bootstrap.ts                     # reinicio seguro
```

#### Mapeo decisión → HTTP (controller)
| Decisión | HTTP | Cuerpo |
|----------|------|--------|
| `AUTHORIZED` | 200 | estado MOVING + posición destino |
| Denegación geométrica / por datos | 200 | `decision: DENIED` + `code`/`collisionType` + `incidentId` |
| Rechazo por estado (`SAFE_STOP_ACTIVE`/`BUSY`) | 409 | `decision: REJECTED` + `code` + estado |
| payload inválido | 422 | `{ code: 'INVALID_DESTINATION', message }` |

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

## Error Handling

- `AppError(status, code, message)` como en la spec 001; `errorHandler` → `{ code, message }`
  sin stack trace (R7.2).
- Denegaciones (geométricas y por datos): **no** son errores de transporte → `200` con la
  decisión en el cuerpo.
- Rechazos por estado (`SAFE_STOP_ACTIVE`, `BUSY`): `409`.
- `ZONE_DATA_UNAVAILABLE` es una **decisión** (200, parada), no un 500: el fallo del
  repositorio se captura en el servicio y se traduce a fallo seguro, nunca se propaga crudo.

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
Tras el arranque, `positionQuality` es `MISSING` y un `MOVING` persistido queda en `SAFE_STOP`.

**Validates: Requirements 6.1, 6.2**

### Property 8: Determinismo y pureza
Para las mismas entradas (`state`, `positionQuality`, `origin`, `destination`, `zones`, `pad`),
`evaluateMovement` devuelve siempre la misma decisión, sin efectos secundarios.

**Validates: Requirements 7.3**

## Testing Strategy

| Nivel | Objetivo | Casos |
|-------|----------|-------|
| Unit (rules) | `evaluateMovement` + `stateMachine` | **T-12**: A(9), B(5), C(3), D(r=10, 5), E(m=5, 3), F(2), G(1) = 28 |
| Unit (rules) | transiciones prohibidas | P-1, P-2 explícitas |
| Unit (service) | orquestación | registro siempre, incidente solo en denegación, rechazo sin incidente, recover válido/ inválido, bootstrap ADR-10 |
| Integración (Supertest) | `/api/robot`, `/api/incidents` | state, move 200/409/422, recover, incidents append-only |
| (UI la cubre la spec 003) | — | — |

> T-12 usa un **doble de `zoneRepository`** (zonas en memoria; caso G simula el fallo) y un
> **doble de `robotRepository`**; no requiere frontend ni base de datos real (R7.4).

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

## Dependencias entre HU
- HU-04/HU-05 dependen de la spec 001 (geometría). La spec 003 consume este contrato.
- `robot_state` se comparte con la spec 003 (esta spec añade `position_quality`).

## Compuerta Fase 2 (DISEÑAR)
- [ ] El humano aprueba explícitamente este `design.md`.
- [ ] Se confirma el mapeo decisión→HTTP (DD-203) y el trato de `ZONE_DATA_UNAVAILABLE` (DD-204).
- [ ] Se confirma el reinicio seguro ADR-10 (DD-207).
