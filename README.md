# Guardián Hogar

Prototipo académico del **Equipo 6 (EAFIT)**: plataforma de seguridad para robots domésticos. El vigilante de seguridad vive en el backend, evalúa cada movimiento antes de autorizarlo y detiene al robot ante colisiones con zonas restringidas o ante información insuficiente. **Todo el sistema es simulado**: no usa hardware ni operación real.

Metodología: **MADA** (ENTENDER → DISEÑAR → CONSTRUIR → VERIFICAR → DEMOSTRAR → OPERAR). Principios rectores en [`constitution.md`](constitution.md).

## Contenido de la entrega

| Entregable                        | Dónde está                                                                |
| --------------------------------- | ------------------------------------------------------------------------- |
| Repositorio del código fuente     | <https://github.com/melyssaS/guardian-hogar-v2>                           |
| Especificaciones y backlog        | [Especificaciones](#2-especificaciones-y-backlog-de-historias-de-usuario) |
| Instalación y ejecución           | [Instalación y ejecución](#3-instalación-y-ejecución)                     |
| Aplicación desplegada             | [Aplicación desplegada](#4-aplicación-desplegada)                         |
| Evidencias de pruebas y seguridad | [Evidencias](#5-evidencias-de-pruebas-y-controles-de-seguridad)           |
| Arquitectura multiagente          | [Arquitectura multiagente](#6-arquitectura-multiagente)                   |

---

## 1. Repositorio del código fuente

Monorepo con npm workspaces (Node 24, TypeScript 5):

```
guardian-hogar-v2/
├── packages/
│   ├── domain/     tipos, esquemas Zod y reglas geométricas compartidas
│   ├── backend/    Node.js + Express + SQLite (better-sqlite3)
│   └── frontend/   React 18 + Vite
├── .kiro/          steering y specs (requirements, design, tasks)
├── .claude/agents/ agentes de MADA
├── prototipo/      prototipo HTML con el backlog original
└── constitution.md principios no negociables del proyecto
```

Arquitectura en capas del backend: `routes → controllers → services → repositories`, con las reglas puras en `rules/`. Los servicios reciben sus dependencias por parámetro y los controladores no contienen lógica.

## 2. Especificaciones y backlog de historias de usuario

Cada spec contiene `requirements.md`, `design.md` y `tasks.md`.

| Spec                                                             | HU cubiertas              | Contenido                                     |
| ---------------------------------------------------------------- | ------------------------- | --------------------------------------------- |
| [`001-restricted-zones`](.kiro/specs/001-restricted-zones)       | HU-02                     | Plano 2D y gestión de zonas restringidas      |
| [`002-safety-guardian`](.kiro/specs/002-safety-guardian)         | HU-04, HU-05              | Vigilante, máquina de estados e incidentes    |
| [`003-movement-simulation`](.kiro/specs/003-movement-simulation) | HU-03 (y HU-01 por RC-01) | Simulación de movimiento y catálogo de robots |

Backlog:

| HU    | Descripción                         | Estado     |
| ----- | ----------------------------------- | ---------- |
| HU-01 | Registrar y consultar robots        | Línea base |
| HU-02 | Configurar zonas restringidas       | Línea base |
| HU-03 | Simular movimiento del robot        | Línea base |
| HU-04 | Detener al robot ante una violación | Línea base |
| HU-05 | Consultar incidentes                | Línea base |

### Historias de usuario reservadas para la demo (HU-06 a HU-10)

No están implementadas en la línea base. El profesor asigna cada una durante la clase y cada integrante la construye en vivo con SDD. En la interfaz hay un marcador de código en el lugar exacto donde se integrará cada una.

| HU    | Historia                                                                                                                                  | Dominio       | Criterios de aceptación                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| HU-06 | Filtrar incidentes por severidad. Como operador, quiero filtrar incidentes para encontrar rápidamente los eventos que requieren atención. | Consultas     | Filtro por una severidad válida. Restablecer el filtro muestra todos los registros. No modifica ni elimina incidentes.                             |
| HU-07 | Exportar incidentes a CSV. Como operador, quiero descargar los incidentes en CSV para analizarlos fuera de la plataforma.                 | Reportes      | Encabezados consistentes y codificación válida. Solo exporta datos autorizados. Escapa correctamente campos con comas y comillas.                  |
| HU-08 | Conteos de incidentes por tipo. Como operador, quiero visualizar el número de incidentes agrupados por tipo.                              | Indicadores   | Los contadores coinciden con la consulta de incidentes. Sin incidentes, muestra cero. No altera los registros originales.                          |
| HU-09 | Buscar robots por nombre. Como operador, quiero buscar un robot por nombre sin recorrer toda la lista.                                    | Catálogo      | Búsqueda sin distinguir mayúsculas de minúsculas. Estado vacío informado con claridad. No modifica el catálogo.                                    |
| HU-10 | Advertencia de batería baja. Como operador, quiero identificar baterías bajas en el catálogo para revisar el estado de las unidades.      | Visualización | Advertencia para nivel inferior al umbral acordado. No modifica las reglas críticas de seguridad. La señal es visible sin depender solo del color. |

Trazabilidad: `HU → requirements.md → design.md → tasks.md → código → pruebas → incidente registrado`.

## 3. Instalación y ejecución

### Requisitos

- Node.js >= 24 y npm

### Pasos

```bash
git clone git@github.com:melyssaS/guardian-hogar-v2.git
cd guardian-hogar-v2
npm install
npm run build:domain      # compila el paquete compartido
```

Desarrollo, en dos terminales:

```bash
npm run dev:backend       # API en http://localhost:3000
npm run dev:frontend      # UI en http://localhost:5173 (proxy /api → backend)
```

### Variables de entorno (backend)

| Variable       | Por defecto                | Uso                                      |
| -------------- | -------------------------- | ---------------------------------------- |
| `PORT`         | `3000`                     | Puerto de la API                         |
| `DB_FILE`      | ver `src/db/connection.ts` | Archivo SQLite                           |
| `CORS_ORIGINS` | `http://localhost:5173`    | Orígenes permitidos, separados por comas |

Frontend: `VITE_PROXY_TARGET` (por defecto `http://localhost:3000`) define el destino del proxy en desarrollo.

No se guardan secretos en el repositorio.

### Endpoints principales

| Método y ruta                                              | Descripción                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /health`                                              | Estado del servicio                                            |
| `GET/POST /api/robots`, `GET /api/robots/:robotId`         | Catálogo de robots                                             |
| `POST /api/robots/:robotId/sessions`                       | Inicia sesión de simulación                                    |
| `GET /api/robots/:robotId/state`                           | Estado del robot                                               |
| `POST /api/robots/:robotId/move`                           | Solicita un movimiento; responde con la decisión del vigilante |
| `POST /api/robots/:robotId/recover`                        | Recuperación validada tras una parada                          |
| `POST /api/robots/:robotId/position`                       | Reporta la posición                                            |
| `GET/POST/PUT/DELETE /api/zones`, `GET /api/zones/changes` | Zonas restringidas y su historial                              |
| `GET /api/incidents`, `GET /api/incidents/:id`             | Incidentes (solo lectura)                                      |

## 4. Aplicación desplegada

- Aplicación: <https://home-guardian-web.onrender.com/>
- API: <!-- TODO: URL pública del backend (verificar con /health) -->

> Desplegado en Render (fase 6, OPERAR). En el plan gratuito el primer acceso puede tardar mientras el servicio se reactiva.

## 5. Evidencias de pruebas y controles de seguridad

### Pruebas

```bash
npm run typecheck     # tipos en los tres paquetes
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # Vitest: domain, backend (unitarias + integración con SQLite en memoria) y componentes del frontend
npm run test:e2e      # Playwright (rooms.spec.ts, simulation.spec.ts)
```

| Nivel                          | Ubicación                            | Herramienta                    |
| ------------------------------ | ------------------------------------ | ------------------------------ |
| Reglas y esquemas de dominio   | `packages/domain/tests`              | Vitest                         |
| Servicios y reglas del backend | `packages/backend/tests/unit`        | Vitest                         |
| Endpoints                      | `packages/backend/tests/integration` | Vitest + Supertest             |
| Componentes                    | `packages/frontend/tests/components` | Vitest + React Testing Library |
| Flujos de usuario              | `packages/frontend/tests/e2e`        | Playwright                     |

Los CI workflows están en `.github/workflows` (análisis SonarQube).

#### Resultados de la última ejecución (24-nov-2026)

| Verificación               | Comando                               | Resultado                             |
| -------------------------- | ------------------------------------- | ------------------------------------- |
| Tipos                      | `npm run typecheck`                   | Sin errores en los tres paquetes      |
| Lint                       | `npm run lint`                        | Sin errores                           |
| Pruebas de `domain`        | `npm test -w @home-guardian/domain`   | 12 archivos, 89 pruebas, todas pasan  |
| Pruebas de `backend`       | `npm test -w @home-guardian/backend`  | 53 archivos, 584 pruebas, todas pasan |
| Pruebas de `frontend`      | `npm test -w @home-guardian/frontend` | 14 archivos, 166 pruebas, todas pasan |
| E2E (Playwright, Chromium) | `npm run test:e2e`                    | 13 de 13 pasan (11,4 s)               |

Total: 839 pruebas unitarias y de integración, más 13 escenarios E2E. Los escenarios E2E llevan en el título el criterio de aceptación que verifican (por ejemplo `CA-03.2`, `CA-03.15`), lo que permite rastrear criterio → prueba.

| Escenario E2E                                                              | Criterio           |
| -------------------------------------------------------------------------- | ------------------ |
| Plano con las 5 habitaciones, switch de restricción, crear y eliminar zona | HU-02, CA-02.2     |
| Catálogo de reglas e historial de cambios                                  | RC-14              |
| Destino libre → `AUTHORIZED`                                               | CA-03.1            |
| Clic en zona restringida → parada preventiva; `recover` → `IDLE`           | CA-03.2, CA-03.4   |
| `recover` con robot en zona activa → `UNSAFE_POSITION`                     | CA-03.13, CA-03.14 |
| Pérdida de conexión → `DEGRADED` + `R-SIGNAL-01`                           | CA-03.15           |
| Alta de robot y rechazo con `ROBOT_START_IN_RESTRICTED_ZONE`               | CA-03.18, CA-03.22 |
| Mismo `sequence` reenviado → `DUPLICATE_EVENT` sin incidente nuevo         | CA-03.11           |
| Un robot denegado no afecta a otro                                         | CA-03.16           |

Reproducir: `npm install && npm test && npm run test:e2e`. La primera vez, `npx playwright install chromium`.

Pendiente: Prettier (`npm run format:check`) reporta estilo en `.github/workflows/sonarqube.yml` y `.prettierrc.json`. No afecta a las pruebas. Falta además adjuntar capturas de pantalla de la ejecución antes de la sustentación.

### Controles de seguridad

| Control                        | Implementación                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Cabeceras HTTP seguras         | `helmet` en toda la app; `x-powered-by` deshabilitado                                   |
| Limitación de peticiones       | `express-rate-limit` en `/api` (300 por minuto por IP)                                  |
| CORS restringido               | Solo los orígenes de `CORS_ORIGINS`                                                     |
| Validación de entradas         | Esquemas Zod en el borde (`validate` middleware); cuerpo JSON limitado a 10 kb          |
| Sin filtración de errores      | `errorHandler` central, sin stack traces en las respuestas                              |
| Vigilante independiente del UI | La decisión se toma en el backend; el frontend solo muestra la respuesta                |
| Fallo seguro                   | Ante información insuficiente o colisión, el robot pasa a `SAFE_STOP`                   |
| Máquina de estados auditable   | IDLE, MOVING, SAFE_STOP, DEGRADED, RECOVERING; cada transición se registra con su causa |
| Incidentes inmutables          | Solo `GET`; no hay `UPDATE` ni `DELETE`                                                 |
| Recuperación validada          | `recover` verifica las condiciones antes de liberar la parada                           |
| Sin secretos en el código      | Configuración por variables de entorno                                                  |

Checklist de la compuerta de oro: todas las pruebas pasan, cada criterio de aceptación tiene prueba, sin secretos (`git grep -i password`), sin `any`, HU-06 a HU-10 sin implementar.

## 6. Arquitectura multiagente

El desarrollo sigue MADA con tres agentes definidos en [`.claude/agents`](.claude/agents). Un humano aprueba cada compuerta.

| Agente                 | Fase MADA          | Permisos            | Función                                                                                             |
| ---------------------- | ------------------ | ------------------- | --------------------------------------------------------------------------------------------------- |
| `analista-requisitos`  | ENTENDER y DISEÑAR | Solo lectura        | Busca ambigüedades, inconsistencias y huecos de trazabilidad en las specs                           |
| `desarrollador-hu`     | CONSTRUIR          | Lectura y escritura | Implementa `tasks.md` con TDD (prueba roja primero) y corrige hallazgos                             |
| `revisor-qa-seguridad` | VERIFICAR          | Lectura y ejecución | Revisión independiente: corre pruebas, verifica criterios y seguridad, y emite APROBADO o RECHAZADO |

```
Humano ──► analista-requisitos ──► [aprobación] ──► desarrollador-hu ──► revisor-qa-seguridad
  ▲                                                        ▲                    │
  │                                                        └── RECHAZADO ◄──────┤
  └────────────────────── [compuerta de oro] ◄── APROBADO ─────────────────────┘
```

El revisor es independiente de quien implementa (constitución, art. XIV). Si rechaza, el código vuelve al desarrollador.

## Equipo

**Equipo 6 — Robotics Software Systems, industria domótica**

- July Dayana Becerra Moreno
- Melyssa Solano Diaz
- Julian David Garcia Paz
- Sergio Stives Barrios Buitrago
