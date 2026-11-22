# Spec 01 — Zonas restringidas — Diseño

**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-01, HU-02
**Estado:** Borrador — pendiente de aprobación humana (compuerta Fase 2)

> Define la **arquitectura y los contratos técnicos**. Depende de `requirements.md` aprobado.

---

## Overview

Diseño técnico de las HU-01 (plano 2D con zonas activas) y HU-02 (CRUD de zonas restringidas). Sigue la funcionalidad vertical frontend → API → dominio → persistencia. El modelo geométrico (expansión conservadora AABB + Liang-Barsky) vive en `@home-guardian/domain` como fuente única de verdad, consumido por backend y frontend. Persistencia en SQLite con `better-sqlite3` sin ORM y migraciones SQL versionadas.

---

## 1. Decisión de stack (nota de conflicto)

La **constitución** manda `SQLite + better-sqlite3 **sin ORM**`, migraciones SQL versionadas y
Node 24. El steering `backend` menciona Prisma. El enunciado de la HU pide explícitamente
"persistencia SQLite vía repositorio" y "migraciones SQL versionadas".

**Decisión:** se sigue la **constitución** → `better-sqlite3` sin ORM, con repositorio y
migraciones SQL. Es la fuente más específica y coincide con el enunciado.
> Esta es una decisión que debe validar el humano (constitución art. XIII).

---

## Architecture

### 2. Arquitectura vertical

```
Frontend (React)                  Backend (Express)                 SQLite
┌───────────────┐   HTTP+JSON   ┌───────────────────────────────┐  ┌─────────┐
│ RoomsPage     │──────────────▶│ zoneController                │  │ zones   │
│ FloorPlan     │               │   → zoneService               │  │ table   │
│ (canvas+grid) │               │       → zoneRepository ───────┼─▶│         │
│ useZones hook │◀──────────────│       → geometry (puro)       │  └─────────┘
└───────────────┘               └───────────────────────────────┘
        ▲                                        ▲
        └──────── @home-guardian/domain ─────────┘
          (tipos Zone, esquemas Zod, constantes y geometría pura)
```

Principio de funcionalidad vertical (constitución art. VII): frontend → API → dominio →
persistencia, todo en esta spec.

---

## Components and Interfaces

### 3. Paquete `@home-guardian/domain`

Fuente única de verdad del modelo geométrico y los contratos.

```
packages/domain/src/
├── models/zone.ts        # tipo Zone, ZoneInput
├── geometry/
│   ├── constants.ts      # FLOOR_WIDTH, FLOOR_HEIGHT, ROBOT_RADIUS, SAFETY_MARGIN
│   ├── aabb.ts           # expandZone, pointInAABB (borde inclusivo)
│   └── collision.ts      # liangBarsky, segmentHitsZone, isCollision
├── schemas/zone.schema.ts# Zod: createZoneSchema, updateZoneSchema, listZoneQuery
└── index.ts
```

### 3.1 Tipos

```ts
export interface Zone {
  id: number;
  name: string;
  x: number; y: number; width: number; height: number;
  active: boolean;
  createdAt: string; // ISO-8601
}

export type ZoneInput = Omit<Zone, 'id' | 'createdAt'>;

export interface AABB { minX: number; minY: number; maxX: number; maxY: number; }
export interface Point { x: number; y: number; }
export interface Segment { from: Point; to: Point; }
```

### 3.2 Constantes

```ts
export const FLOOR_WIDTH = 1000;
export const FLOOR_HEIGHT = 800;

// r y m son CONFIGURABLES por variable de entorno; por defecto 0.
// Sin configuración, pad = r + m = 0 → la zona no se expande.
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const ROBOT_RADIUS = envNumber('ROBOT_RADIUS', 0);  // r — por defecto 0
export const SAFETY_MARGIN = envNumber('SAFETY_MARGIN', 0); // m — por defecto 0
export const COLLISION_PAD = ROBOT_RADIUS + SAFETY_MARGIN;  // pad total r + m
```

> Las constantes `ROBOT_RADIUS` y `SAFETY_MARGIN` se leen de las variables de entorno del
> mismo nombre y valen `0` por defecto. Las pruebas y specs que necesitan expansión fijan el
> `pad` de forma explícita (ver `isCollision` con `pad` opcional, §3.3), por lo que no
> dependen del valor por defecto ni de que el entorno esté configurado.

### 3.3 Geometría pura (DD-001 — AABB conservador)

```ts
// aabb.ts
export function expandZone(z: {x:number;y:number;width:number;height:number},
                           pad: number): AABB {
  return {
    minX: z.x - pad,
    minY: z.y - pad,
    maxX: z.x + z.width + pad,
    maxY: z.y + z.height + pad,
  };
}

// borde inclusivo: <= y >=
export function pointInAABB(p: Point, b: AABB): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}
```

```ts
// collision.ts — Liang-Barsky, segmento contra AABB, borde inclusivo
export function segmentIntersectsAABB(s: Segment, b: AABB): boolean {
  // Caso degenerado: origen == destino → reducir a pointInAABB.
  // t0=0, t1=1; para cada eje p=-dx/+dx, q=(min/max - from);
  // rechazo cuando p==0 && q<0 (paralelo y fuera).
  // aceptación con bordes inclusivos (<=, >=).
}
```

```ts
// Causa de la colisión. La spec 002 (Vigilante) mapea cada tipo a su respuesta:
//   ORIGIN_IN_RESTRICTED_ZONE  → origen dentro de la zona expandida
//   RESTRICTED_ZONE_VIOLATION  → destino dentro de la zona expandida
//   TRAJECTORY_CROSSES_ZONE    → la trayectoria interseca la zona expandida
export type CollisionType =
  | 'ORIGIN_IN_RESTRICTED_ZONE'
  | 'RESTRICTED_ZONE_VIOLATION'
  | 'TRAJECTORY_CROSSES_ZONE';

export interface CollisionResult {
  collides: boolean;
  type: CollisionType | null; // null cuando no hay colisión
}

// API de colisión que consumen las reglas de simulación.
// `pad` es opcional: por defecto COLLISION_PAD (que depende de r+m del entorno).
// Las pruebas y la spec 002 pueden pasar un pad explícito para fijar r+m sin
// depender de variables de entorno.
export function isCollision(
  zone: Zone,
  s: Segment,
  pad: number = COLLISION_PAD,
): CollisionResult {
  const box = expandZone(zone, pad);

  // Orden de prioridad del tipo: origen dentro > destino dentro > trayectoria interseca.
  if (pointInAABB(s.from, box))
    return { collides: true, type: 'ORIGIN_IN_RESTRICTED_ZONE' };
  if (pointInAABB(s.to, box))
    return { collides: true, type: 'RESTRICTED_ZONE_VIOLATION' };
  if (segmentIntersectsAABB(s, box))
    return { collides: true, type: 'TRAJECTORY_CROSSES_ZONE' };

  return { collides: false, type: null };
}
```

> `isCollision` devuelve **`{ collides, type }`**: además de decir si hay colisión, reporta
> su **causa** (`CollisionType`). La spec 002 (Vigilante) consume ese `type` directamente
> para responder `ORIGIN_IN_RESTRICTED_ZONE`, `RESTRICTED_ZONE_VIOLATION` o
> `TRAJECTORY_CROSSES_ZONE`, sin recalcular la geometría ni modificar esta spec.
> En esta spec se exporta y se prueba (B1–B9); la evaluación en vivo del robot pertenece a
> la spec 002.

### 3.4 Esquemas Zod

```ts
export const zoneInputSchema = z.object({
  name: z.string().trim().min(1),
  x: z.number(), y: z.number(),
  width: z.number(), height: z.number(),
  active: z.boolean().default(true),
});
export const createZoneSchema = zoneInputSchema;
export const updateZoneSchema = zoneInputSchema.partial();
export const listZoneQuerySchema = z.object({
  active: z.enum(['all', 'false']).optional(),
});
```
> Las reglas de dimensiones y de límites del plano **no** se codifican como errores Zod
> genéricos: se validan en el servicio para emitir los `code` específicos
> (`INVALID_ZONE_DIMENSIONS`, `ZONE_OUT_OF_BOUNDS`). Zod solo valida forma y tipos.

---

## 4. Backend

```
packages/backend/src/
├── controllers/zoneController.ts   # solo recibe/responde
├── services/zoneService.ts         # reglas de negocio + validaciones de dominio
├── repositories/zoneRepository.ts  # acceso SQLite (better-sqlite3)
├── routes/zoneRoutes.ts            # /api/zones
├── middlewares/validate.ts         # Zod → 422
├── middlewares/errorHandler.ts     # AppError → {code,message} + HTTP
├── db/connection.ts                # instancia better-sqlite3
└── db/migrate.ts                   # runner de migraciones versionadas
packages/backend/migrations/
└── 001_create_zones.sql
```

### 4.1 Contrato de capas (SOLID)
- **Controller (S):** parsea request, llama al servicio, mapea a HTTP. Sin lógica.
- **Service (D):** recibe `zoneRepository` por parámetro (inyección manual). Valida
  dimensiones y límites del plano; lanza `AppError` con `code` + status.
- **Repository:** CRUD sobre SQLite, detecta violación de unicidad de `name`.
- **Geometry (O):** funciones puras en domain; nuevas reglas no modifican las existentes.

## Error Handling

### 4.2 Errores de dominio

```ts
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
// Fábricas:
ZONE_NOT_FOUND         → 404
ZONE_NAME_DUPLICATE    → 409
INVALID_ZONE_DIMENSIONS→ 422
ZONE_OUT_OF_BOUNDS     → 422
```

`errorHandler` traduce `AppError` a `{ code, message }` con el status; cualquier error no
controlado → `500` con mensaje genérico, **sin stack trace** (RNF-04).

### 4.3 Validaciones del servicio

```ts
function assertDimensions(z: ZoneInput) {
  if (z.width <= 0 || z.height <= 0)
    throw invalidDimensions();            // 422 INVALID_ZONE_DIMENSIONS
}
function assertWithinFloor(z: ZoneInput) {
  if (z.x < 0 || z.y < 0 ||
      z.x + z.width > FLOOR_WIDTH ||
      z.y + z.height > FLOOR_HEIGHT)
    throw outOfBounds();                  // 422 ZONE_OUT_OF_BOUNDS
}
```
Unicidad de `name`: el repositorio usa `UNIQUE` en SQLite; el servicio traduce la violación
a `ZONE_NAME_DUPLICATE` (409). En `PUT`, se excluye el propio id al comprobar duplicado.

### 4.4 Lista con filtro `active`
- sin query → `WHERE active = 1`
- `?active=all` → sin filtro
- `?active=false` → `WHERE active = 0`

---

## Data Models

### 5. Persistencia

### 5.1 Migración `001_create_zones.sql`
```sql
CREATE TABLE IF NOT EXISTS zones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  width      REAL    NOT NULL,
  height     REAL    NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,  -- 0/1
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### 5.2 Migraciones versionadas
- Archivos `NNN_descripcion.sql` en `packages/backend/migrations/`, orden lexicográfico.
- Tabla de control `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT)`.
- `db/migrate.ts` aplica en transacción las migraciones aún no registradas.

### 5.3 Repositorio (mapeo)
- `active` TEXT/INTEGER `0|1` ↔ `boolean`.
- `created_at` ↔ `createdAt` (ISO).
- Métodos: `create`, `findById`, `findAll(filter)`, `update`, `delete`, `existsByName(name, exceptId?)`.

---

## 6. Frontend

```
packages/frontend/src/
├── api/client.ts            # fetch base + objeto zonesApi
├── pages/RoomsPage.tsx      # HU-02 (CRUD) + HU-01 (plano)
├── components/FloorPlan.tsx # canvas/SVG: cuadrícula + zonas activas
├── components/ZoneForm.tsx  # alta/edición
├── components/ZoneList.tsx  # listar/activar/desactivar/eliminar
├── hooks/useZones.ts        # fetching + estados carga/error
└── types/                   # reexporta @home-guardian/domain
```

### 6.1 `FloorPlan` (HU-01)
- Dibuja el plano a escala `FLOOR_WIDTH × FLOOR_HEIGHT` con un factor de escala al viewport.
- Cuadrícula de referencia (p. ej. cada 100 u).
- Pinta solo zonas con `active=true`, en su `(x,y,width,height)` reales, destacadas.
- Origen arriba-izquierda (eje Y hacia abajo), coherente con el modelo.

### 6.2 `zonesApi` (todas las llamadas por `client.ts`)
```ts
zonesApi.list(filter?: 'all'|'false')   // GET /api/zones
zonesApi.get(id)                        // GET /api/zones/:id
zonesApi.create(input)                  // POST
zonesApi.update(id, input)              // PUT
zonesApi.remove(id)                     // DELETE
```
- `useZones` maneja carga/error por operación (RNF frontend).
- Activar/desactivar = `update(id, { active })`.
- Tras cada mutación, refrescar la lista para re-renderizar el plano (RF-01.4).

---

## Testing Strategy

### 7. Mapa de pruebas (preparación Fase VERIFICAR)

| Nivel | Objetivo | Casos |
|-------|----------|-------|
| Unit (domain) | geometría pura | **B1–B9**, `expandZone`, `pointInAABB`, degenerado |
| Unit (backend) | servicio | dimensiones 422, out-of-bounds 422, duplicado 409, filtro active |
| Integración (Supertest) | endpoints | POST/GET/GET:id/PUT/DELETE + códigos de error |
| Componentes (RTL) | ZoneForm/List | validación visual, activar/desactivar, eliminar |
| E2E (Playwright) | humo | plano con cuadrícula + crear zona + verla destacada |

---

## Correctness Properties

Propiedades que deben cumplirse siempre (base para pruebas de propiedad y B1–B9):

### Property 1: Conservadurismo
Si un punto está dentro de la zona base, `isCollision(...).collides` es verdadero; la expansión `r+m` nunca reduce el área de colisión.

**Validates: Requirements 2.1** (modelo geométrico, regla 1; escenarios B1, B5, B6)

### Property 2: Borde inclusivo
Un punto exactamente en el borde de la zona expandida cuenta como colisión (`≤`, `≥`).

**Validates: Requirements 2.2** (modelo geométrico, regla 2; escenarios B5, B8)

### Property 3: Origen dentro
Si el origen del segmento está dentro de la zona expandida, `isCollision(...).collides` es verdadero y `type === 'ORIGIN_IN_RESTRICTED_ZONE'`, independientemente del destino.

**Validates: Requirements 2.4** (modelo geométrico, regla 4; escenario B4)

### Property 4: Simetría del segmento
El valor `collides` de `isCollision(zone, from→to)` es igual al de `isCollision(zone, to→from)`. El `type` puede diferir según qué extremo quede dentro (p. ej. origen vs destino).

**Validates: Requirements 2.3** (modelo geométrico, regla 3; escenarios B3, B4)

### Property 5: Segmento degenerado
Con `from == to`, `isCollision(...).collides` equivale a `pointInAABB(from, expandida)` y nunca lanza (sin división por cero en Liang-Barsky).

**Validates: Requirements 2.4** (modelo geométrico, regla 4; escenario B9)

### Property 6: Invariante de validación
Toda zona persistida cumple `width>0`, `height>0` y queda dentro del plano `FLOOR_WIDTH × FLOOR_HEIGHT`.

**Validates: Requirements 3.1, 3.2, 3.3** (RF-03; CA-02.3, CA-02.4)

---

## 8. Decisiones de diseño

| ID | Decisión | Alternativa descartada | Justificación |
|----|----------|------------------------|---------------|
| DD-001 | AABB conservador: expandir zona `r+m` por lado | Colisión círculo-rectángulo exacta | Simple, seguro (sobre-estima), suficiente para rectángulos |
| DD-002 | Liang-Barsky para segmento vs AABB | Parametrización ad hoc por aristas | Estándar, maneja bordes y rechazos de forma robusta |
| DD-003 | Borde inclusivo (`≤`,`≥`) | Exclusivo | Fallo seguro: el contacto cuenta como colisión |
| DD-004 | Geometría en `@home-guardian/domain` | Duplicar en front y back | Fuente única; front puede previsualizar sin reimplementar |
| DD-005 | `better-sqlite3` sin ORM + migraciones SQL | Prisma | Constitución art. IX; enunciado pide migraciones SQL |
| DD-006 | `name UNIQUE` en BD + traducción a 409 | Solo chequeo en servicio | Evita carrera; la BD es la autoridad de unicidad |
| DD-007 | Validaciones de dominio en servicio, no en Zod | Todo en Zod | Permite `code` HTTP específicos por regla |
| DD-008 | `r` y `m` configurables por variable de entorno, default `0` | Constantes fijas `20`/`10` | La spec 002 varía `r` y `m` (T-12 grupos D y E); con constantes fijas no podría reproducir esos escenarios |
| DD-009 | `isCollision` devuelve `{ collides, type }` | Solo `boolean` | El Vigilante (002) necesita la causa para responder `ORIGIN_IN_RESTRICTED_ZONE` / `RESTRICTED_ZONE_VIOLATION` / `TRAJECTORY_CROSSES_ZONE` sin recalcular geometría |

---

## 9. Dependencias entre HU
- HU-01 depende de HU-02 para tener zonas que mostrar; ambas comparten `Zone` y el plano.
- La geometría (`isCollision`) queda lista aquí pero su uso por el robot pertenece a la
  spec 002 (fuera de alcance de esta spec, solo se prueba la función).
- La spec 002 (Vigilante) consume de esta spec: `r` y `m` configurables por variable de
  entorno y `isCollision` que devuelve `{ collides, type }`. Sus escenarios (grupos D y E
  del T-12, 28 escenarios) varían `r` y `m`, y usan el `type` para elegir la respuesta. No
  necesita modificar esta spec ni recalcular geometría.

---

## 10. Compuerta Fase 2 (DISEÑAR)
- [ ] El humano aprueba explícitamente este `design.md`.
- [x] Se confirma la decisión DD-005 (better-sqlite3 sin ORM, aprobado por el equipo).
- [x] Se fijan los valores de `ROBOT_RADIUS = 20` y `SAFETY_MARGIN = 10` (pad `30`).
