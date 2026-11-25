# Tasks Document

**Spec:** `008-incident-counts-by-type`
**Fase MADA:** CONSTRUIR
**HU cubiertas:** HU-08
**Estado:** Borrador (pendiente de aprobación humana)

> Método: **TDD** — cada tarea de implementación escribe primero la **prueba en rojo**, luego el
> código mínimo para pasarla (constitución art. V). Orden vertical: dominio → backend → frontend
> (art. VII). Trazabilidad criterio → tarea → prueba al final.

---

## Tareas

### T1 — Dominio: contrato del resultado
- [ ] Crear `packages/domain/src/models/incidentCounts.ts` (en `models/`, no en `schemas/`,
  porque son tipos sin Zod — H-3) con los tipos `IncidentTypeCount` (`rule: RuleId`,
  `title: string`, `count: number`) e `IncidentCounts` (`total: number`,
  `byType: IncidentTypeCount[]`).
- [ ] Exportarlos en `packages/domain/src/index.ts`.
- Sin lógica aún; solo tipos. No requiere prueba propia (lo cubren T2–T3).

### T2 — Dominio (TDD): función pura de conteo — ROJO
- [ ] Escribir `packages/domain/tests/incidentCounts.test.ts` con los casos:
  - Con incidentes de varias reglas → cada categoría cuenta lo suyo y `total` = suma. **(CA-08.1, CA-08.2)**
  - Lista vacía → las 3 categorías en `0` y `total` `0`, en el orden del catálogo. **(CA-08.3)**
  - Mismo arreglo de entrada llamado dos veces → mismo resultado (determinismo). **(CA-08.5)**
  - La función no muta el arreglo de entrada. **(CA-08.4)**
- [ ] Ejecutar y **mostrar la prueba en rojo** (la función aún no existe).

### T3 — Dominio: implementar `countIncidentsByType` — VERDE
- [ ] Crear `packages/domain/src/rules/incidentCounts.ts` con
  `countIncidentsByType(incidents: readonly Incident[]): IncidentCounts`:
  recorre `RULES` (orden fijo), cuenta incidentes por `rule`, arma `byType` y `total`.
  Pura, sin efectos, sin mutar la entrada.
- [ ] Exportar en `index.ts`.
- [ ] Pruebas de T2 en **verde**.

### T4 — Backend (TDD): endpoint de conteos — ROJO
- [ ] Añadir a `packages/backend/tests/integration/incidents.api.test.ts` (o archivo nuevo
  `incidentsCounts.api.test.ts`) los casos sobre `GET /api/incidents/counts`:
  - **Orden de rutas (H-2):** `GET /api/incidents/counts` responde el contrato de conteos
    (objeto `{ total, byType }`), y NO un `422` de validación ni `404 INCIDENT_NOT_FOUND`;
    esto prueba que la ruta `/counts` precede a `/:id` y no es capturada por `:id`. **(CA-08.1)**
  - Responde `200` con `byType` (3 categorías en orden de catálogo) y `total`. **(CA-08.1)**
  - `total` = número de elementos de `GET /api/incidents` **sin filtros**. **(CA-08.2)**
  - Base sin incidentes → todo en `0`. **(CA-08.3)**
  - Tras llamar a `/counts`, `GET /api/incidents` devuelve lo mismo que antes (no se altera). **(CA-08.4)**
- [ ] Ejecutar y **mostrar en rojo** (ruta aún no existe).

### T5 — Backend: handler y ruta — VERDE
- [ ] En `incidentController.ts`, añadir `counts(req, res)`: `incidents.findAll({})` →
  `countIncidentsByType(...)` → `res.json(...)`. Sin lógica de conteo en el controlador.
- [ ] En `incidentRoutes.ts`, registrar `router.get('/counts', c.counts)` **antes** de
  `router.get('/:id', …)`.
- [ ] Pruebas de T4 en **verde**.

### T6 — Frontend API: cliente
- [ ] En `packages/frontend/src/api/client.ts`, añadir `incidentsApi.counts()` **sin parámetros**
  (coherente con DD-08.6/DD-08.9, no replicar la firma `list(robotId?)` — H-7) →
  `request<IncidentCounts>('/api/incidents/counts')`.
- [ ] Reexportar `IncidentCounts`, `IncidentTypeCount` en `packages/frontend/src/types/index.ts`.

### T7 — Frontend (TDD): componente de presentación — ROJO
- [ ] Crear `packages/frontend/tests/components/IncidentCounts.test.tsx`:
  - Dado un `IncidentCounts` con valores → renderiza los 3 títulos, sus números y el total. **(CA-08.6)**
  - Todos en `0` → muestra `0` en cada tipo (no oculta categorías). **(CA-08.8)**
- [ ] Ejecutar y **mostrar en rojo** (el componente aún no existe).

### T8 — Frontend: componente `IncidentCounts` — VERDE
- [ ] Crear `packages/frontend/src/components/IncidentCounts.tsx` (funcional, sin `any`):
  recibe `counts: IncidentCounts` y los pinta (una píldora/tarjeta por tipo + total).
  Solo presentación; no calcula.
- [ ] Pruebas de T7 en **verde**.

### T9 — Frontend (TDD): hook y página — ROJO
- [ ] Ampliar `packages/frontend/tests/components/IncidentsPage.test.tsx`:
  - Al montar, la página pide conteos y los muestra en el marcador de HU-08. **(CA-08.6)**
  - Al **volver a montar** la página (recarga), se piden los conteos de nuevo y reflejan el
    valor vigente. **(CA-08.7)**
  - El error de los conteos se muestra **dentro de `IncidentCounts`** y NO afecta al callout
    global ni a la tabla/detalle (`status.list`/`status.detail` intactos). **(CA-08.9)**
- [ ] Ejecutar y **mostrar en rojo**.

### T10 — Frontend: integrar en el hook y la página — VERDE
- [ ] En `useIncidents.ts`, añadir `'counts'` al tipo `IncidentsOperation`, cargar
  `incidentsApi.counts()` dentro de `refresh` y exponer `counts` y `status.counts` en el
  retorno. El `error`/`loading` de `counts` queda **aislado** en `status.counts`; no se mezcla
  con `status.list`/`status.detail` ni con el `error` derivado de la página (H-5).
- [ ] En `IncidentsPage.tsx`, reemplazar el marcador reservado de HU-08 por
  `<IncidentCounts counts={counts} status={status.counts} />`. El componente resuelve su propia
  carga/error (CA-08.9). No tocar la tabla ni el detalle ni el callout global.
- [ ] Pruebas de T9 en **verde**.

### T11 — Verificación final (compuerta)
- [ ] `npm run build:domain`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] Reportar los conteos (archivos/pruebas) de cada comando.

---

## Matriz de trazabilidad criterio → tarea → prueba

| Criterio | Tarea(s) | Prueba |
|----------|----------|--------|
| CA-08.1 | T2, T3, T4, T5 | `incidentCounts.test.ts` + `incidents(.counts).api.test.ts` (incluye prueba de orden `/counts` antes de `/:id`, H-2) |
| CA-08.2 | T2, T3, T4, T5 | integración: `total` = longitud de `GET /api/incidents` |
| CA-08.3 | T2, T3, T4, T5 | dominio e integración: sin incidentes → todo en `0` |
| CA-08.4 | T2, T3, T4, T5 | dominio (no muta) + integración (incidentes sin cambios) |
| CA-08.5 | T2, T3 | dominio: mismo conjunto → mismos conteos |
| CA-08.6 | T7, T8, T9, T10 | `IncidentCounts.test.tsx` + `IncidentsPage.test.tsx` |
| CA-08.7 | T9, T10 | `IncidentsPage.test.tsx`: `refresh` recarga conteos |
| CA-08.8 | T7, T8 | `IncidentCounts.test.tsx`: todo en `0` |
| CA-08.9 | T9, T10 | `IncidentsPage.test.tsx`: carga y error |

---

## Notas de implementación
- No usar `any`; tipos compartidos desde `@home-guardian/domain`.
- No tocar la tabla ni el detalle de incidentes existentes (spec 003 R9).
- No implementar HU-06 ni HU-07 (siguen reservadas).
- Este documento no implica código todavía: la implementación es el Prompt C.
