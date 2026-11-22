# Skill — Arquitectura del sistema

## Visión general
Home Guardian es una plataforma de seguridad robótica para hogares inteligentes. Usa un monorepo con npm workspaces dividido en tres paquetes.

## Estructura del monorepo

```
home-guardian/
├── packages/
│   ├── domain/         tipos y contratos compartidos (TypeScript)
│   ├── backend/        Node.js + Express + Prisma
│   └── frontend/       React + Vite
├── package.json        workspace root
└── .kiro/
```

### Paquete domain — @home-guardian/domain
Contiene los tipos TypeScript y esquemas Zod compartidos entre backend y frontend.
Ningún paquete duplica tipos — siempre importa de aquí.

```
packages/domain/
├── src/
│   ├── models/         tipos Robot, Room, Incident
│   ├── schemas/        esquemas Zod compartidos
│   └── index.ts
└── package.json
```

## Diagrama de capas

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND                          │
│           React 18 + TypeScript + Vite              │
│         http://localhost:5173 (dev)                 │
│              Render (producción)                    │
└─────────────────────┬───────────────────────────────┘
                      │ HTTP + JSON
                      │ Basic Auth
                      ▼
┌─────────────────────────────────────────────────────┐
│                   BACKEND                           │
│         Node.js 20 + TypeScript + Express           │
│         http://localhost:3000 (dev)                 │
│              Render (producción)                    │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Controllers │→ │  Services   │→ │Repositories │ │
│  └─────────────┘  └──────┬──────┘  └──────┬──────┘ │
│                          │                │ Prisma  │
│                   ┌──────┴──────┐         │         │
│                   │ Rule Engine │         │         │
│                   │  ZoneRule   │         │         │
│                   └─────────────┘         │         │
└───────────────────────────────────────────┼─────────┘
                                            ▼
┌─────────────────────────────────────────────────────┐
│                 BASE DE DATOS                       │
│                SQLite + Prisma ORM                  │
│           dev.db (dev), Render (prod)               │
└─────────────────────────────────────────────────────┘
```

---

## Componentes del backend

| Archivo | Ruta | HU |
|---------|------|----|
| `robotController.ts` | `/api/robots` | HU-01, HU-09 |
| `roomController.ts` | `/api/rooms` | HU-02 |
| `guardianController.ts` | `/api/telemetry` | HU-03, HU-04 |
| `incidentController.ts` | `/api/incidents` | HU-05, HU-06, HU-07, HU-08 |

---

## Modelo de datos (Prisma schema)

```prisma
model Robot {
  id        Int        @id @default(autoincrement())
  name      String
  type      RobotType
  state     RobotState @default(INACTIVE)
  battery   Float      @default(100)
  createdAt DateTime   @default(now())
  incidents Incident[]
}

model Room {
  id         Int     @id @default(autoincrement())
  name       String  @unique
  restricted Boolean @default(false)
  x          Float
  y          Float
  width      Float
  height     Float
}

model Incident {
  id         Int        @id @default(autoincrement())
  robot      Robot      @relation(fields: [robotId], references: [id])
  robotId    Int
  ruleId     String
  roomName   String
  decision   Decision
  severity   Severity
  detail     String
  eventKey   String     @unique
  occurredAt DateTime   @default(now())
}

enum RobotType  { VACUUM GUARD }
enum RobotState { ACTIVE STOPPED INACTIVE NO_SIGNAL }
enum Decision   { STOP PAUSE_LOCAL }
enum Severity   { LOW MEDIUM HIGH CRITICAL }
```

---

## Contrato de telemetría

### Request
```json
{
  "robotId": 1,
  "simulationId": "SIM-001",
  "sequence": 142,
  "position": { "x": 92.0, "y": 303.0 },
  "speed": 0.48,
  "battery": 86.0
}
```

### Response STOP
```json
{
  "robotId": 1,
  "decision": "STOP",
  "ruleId": "R-ZONA-01",
  "room": "Stairs",
  "incidentId": 1,
  "reason": "Robot entered restricted zone: Stairs"
}
```

---

## Habitaciones iniciales (seed)

| Nombre | x | y | width | height | Restringida |
|--------|---|---|-------|--------|-------------|
| Living Room | 29 | 30 | 250 | 178 | No |
| Kitchen | 296 | 30 | 270 | 178 | No |
| Stairs | 29 | 226 | 160 | 178 | Sí |
| Baby Room | 206 | 226 | 187 | 178 | Sí |
| Hallway | 410 | 226 | 156 | 178 | No |

---

## Arquitectura de despliegue

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  Render  │     │    Render    │     │    Render    │
│ Frontend │────►│   Backend    │────►│    SQLite    │
│  React   │     │   Node.js    │     │  (volumen)   │
└──────────┘     └──────────────┘     └──────────────┘
```

### Variables de entorno — backend (Render)
```
DATABASE_URL=postgresql://...
JWT_SECRET=...
BCRYPT_ROUNDS=12
ADMIN_USER=...
ADMIN_PASSWORD=...
CORS_ORIGINS=https://home-guardian.onrender.com
PORT=3000
```

### Variables de entorno — frontend (Render)
```
VITE_API_URL=https://home-guardian-api.onrender.com
VITE_API_USER=...
VITE_API_PASSWORD=...
```

---

## Decisiones de arquitectura

| Decisión | Alternativa descartada | Justificación |
|----------|----------------------|---------------|
| Motor de reglas en backend | En frontend | La seguridad no puede depender del cliente |
| SQLite (dev) / PostgreSQL (CI + prod) | Solo PostgreSQL | SQLite simplifica desarrollo local; PostgreSQL real en CI garantiza fidelidad |
| npm workspaces | Repos separados | Tipos compartidos sin duplicación |
| Zod | class-validator | Funciona en frontend y backend, integra con TypeScript |
| JWT en cookie httpOnly | HTTP Basic Auth | Más seguro, no expone credenciales en cada request |
| bcrypt | MD5 / SHA1 | Estándar de la industria para hash de contraseñas |
| helmet + rate-limit | Sin protección | Cabeceras seguras y prevención de abuso desde el inicio |
| Playwright prioritario | Solo unit tests | El profesor evalúa comportamiento visible en demo |
