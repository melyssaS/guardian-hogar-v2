# Implementation Plan: Exportar incidentes a CSV (007-export-incidents-csv)

**Fase MADA:** CONSTRUIR
**HU cubiertas:** HU-07
**Contexto:** demo en vivo, responsable Melyssa
**Estado:** **Aprobado** por el humano (2026-11-24), revisión 2 (tras informe del analista-requisitos)

## Overview

Plan en **TDD**: cada tarea marcada 🔴 escribe la prueba y la deja **en rojo** antes de la tarea
de implementación que la pone en verde. Orden: spec 003 → backend → frontend → E2E → calidad.

---

## Tasks

### Paso 0 — Coherencia con la spec 003
- [x] **T0.** En `.kiro/specs/003-movement-simulation/requirements.md`, marcar RF-09.4 y CA-03.27
  como "HU-07: sustituido por spec 007 CA-07.10" y añadir una entrada al §12 con fecha y razón.
  Solo documentación; requiere aprobación humana (art. XIII).
  _CA: CA-07.10, CA-07.14_

### Paso 1 — Codificador puro (backend)
- [x] **T1. 🔴** `packages/backend/tests/unit/incidentCsv.test.ts`: BOM inicial; encabezados
  exactos; N filas en el orden recibido; `String(n)`; `null` → vacío; `createdAt` sin cambios;
  lista vacía → BOM + encabezados; `Cuarto del bebé` se decodifica con
  `TextDecoder('utf-8', { fatal: true })`.
  _CA: CA-07.1, CA-07.4, CA-07.6_
- [x] **T2. 🔴** En el mismo archivo: escape de `,`, `"`, `\n` y `\r` en `reason` y `zoneName`.
  Al reparsear con RFC 4180 debe haber 14 columnas y el valor recuperado. Mitigación: `=`, `+`, `-`,
  `@`, `\t` y `\r` iniciales en `robotName`, `zoneName` y `reason` → prefijo `'`. Las columnas
  numéricas y de vocabulario cerrado no se alteran. Un valor mitigado que contiene `,` se
  entrecomilla después del prefijo.
  _CA: CA-07.3, CA-07.9_
- [x] **T3.** Implementar `packages/backend/src/rules/incidentCsv.ts` (`INCIDENT_CSV_HEADERS`,
  `toCsvCell`, `incidentsToCsv`; puro, sin `any`). Pone en verde T1 y T2.
  _CA: CA-07.1, CA-07.3, CA-07.4, CA-07.6, CA-07.9_

### Paso 2 — Servicio
- [x] **T4. 🔴** `packages/backend/tests/unit/incidentExportService.test.ts`, con repositorio y
  catálogo falsos y `now = () => new Date('2026-11-23T23:59:59Z')`:
  - `filename === 'incidentes-2026-11-23.csv'`.
  - El filtro `robotId` se pasa a `findAll`.
  - Un robot inexistente lanza `ROBOT_NOT_FOUND` y no se llama a `findAll`.
  - El servicio solo usa métodos de lectura (`create` no se llama).
  _CA: CA-07.2, CA-07.5, CA-07.8_
- [x] **T5.** Implementar `packages/backend/src/services/incidentExportService.ts`
  (`{ incidents, catalog, now }` por parámetro). Pone en verde T4.
  _CA: CA-07.2, CA-07.5, CA-07.8_

### Paso 3 — API
- [x] **T6. 🔴** `packages/backend/tests/integration/incidentsExport.api.test.ts` (Supertest
  sobre `createApp(:memory:)`):
  - `200` con `Content-Type: text/csv; charset=utf-8`, BOM y encabezados.
  - Las filas siguen el orden de `GET /api/incidents`.
  - `?robotId=1` devuelve los mismos `id` que `GET /api/incidents?robotId=1`, sin filas del robot 2.
  - `?robotId=999` → `404 ROBOT_NOT_FOUND` en JSON.
  - `abc`, `0` y `-1` → `422 VALIDATION_ERROR`, sin `stack`.
  - Sin incidentes → BOM + encabezados.
  - `Content-Disposition` cumple `^attachment; filename="incidentes-\d{4}-\d{2}-\d{2}\.csv"$`.
  - Con un `Origin` permitido, `Access-Control-Expose-Headers` contiene `Content-Disposition`.
  - El número de filas en `incidents` y en `audit_log` es igual antes y después.
  - Un incidente en "Cuarto del bebé" se decodifica bien.
  _CA: CA-07.1, CA-07.2, CA-07.4, CA-07.5, CA-07.6, CA-07.7, CA-07.8_
- [x] **T7.** Implementar:
  - El handler `exportCsv` en `controllers/incidentController.ts`.
  - La ruta `GET /export` en `routes/incidentRoutes.ts`, antes de `/:id`, con
    `validate(incidentListQuerySchema, 'query')`.
  - En `app.ts`: `exposedHeaders: ['Content-Disposition']` en CORS y el servicio inyectado
    con `now: () => new Date()`.

  Pone en verde T6 sin romper `incidents.api.test.ts`.
  _CA: CA-07.1, CA-07.5, CA-07.7_

### Paso 4 — Interfaz
- [x] **T8. 🔴** En `packages/frontend/tests/components/IncidentsPage.test.tsx`:
  - Cambiar la prueba `CA-03.27` para que solo afirme HU-06 `disabled`, y que la nota mencione
    solo HU-06 (CA-07.14).
  - Click en "Exportar CSV · HU-07" → un único `GET /api/incidents/export`, sin query.
    `URL.createObjectURL` recibe el **mismo** `Blob` del `fetch` simulado, y `a.download` es el
    `filename` de la cabecera, o `incidentes.csv` si no viene (CA-07.10, CA-07.11).
  - Durante la petición: botón `disabled` con el texto "Exportando…" (CA-07.12).
  - Respuesta `404 { code, message }` → `role="alert"` con el `message` y `createObjectURL`
    no se llama (CA-07.13).
  _CA: CA-07.10, CA-07.11, CA-07.12, CA-07.13, CA-07.14_
- [x] **T9.** Implementar `requestBlob` e `incidentsApi.exportCsv()` en `api/client.ts`, con el
  mismo manejo de errores que `request`.
  _CA: CA-07.10, CA-07.11, CA-07.13_
- [x] **T10.** Añadir la operación `'export'` y la acción `exportCsv()` en `hooks/useIncidents.ts`:
  `createObjectURL` solo si hay éxito, `<a download>` temporal y `revokeObjectURL`.
  _CA: CA-07.10–CA-07.13_
- [x] **T11.** En `pages/IncidentsPage.tsx`:
  - Habilitar el botón HU-07 (estado de carga, texto "Exportando…", error en el `role="alert"`
    existente).
  - Dejar el botón HU-06 `disabled` con `{/* HU-06: filtrar por severidad — reservado para demo en vivo */}`.
  - Cambiar la nota a "HU-06 está reservada, no implementada.".

  Ponen en verde T8: T9, T10 y T11.
  _CA: CA-07.10–CA-07.14_

### Paso 5 — E2E y calidad
- [x] **T12. 🔴→🟢** `packages/frontend/tests/e2e/incidents.spec.ts`: en "Incidentes", click en
  "Exportar CSV · HU-07" → `page.waitForEvent('download')`, con
  `suggestedFilename()` que cumple `^incidentes-\d{4}-\d{2}-\d{2}\.csv$`.
  _CA: CA-07.10_
- [x] **T13. Compuerta de oro (local; CI pendiente del push):** ESLint y Prettier sin errores, cero `any`, sin secretos
  (`git grep -i password`), todas las pruebas en verde (incluida la `CA-03.27` modificada) y CI
  en verde.

---

## Trazabilidad criterio → CA → tarea → prueba

| Criterio de la historia | CA | Tareas | Prueba(s) |
|-------------------------|----|--------|-----------|
| (a) Encabezados / UTF-8 | CA-07.1 | T1, T3, T6, T7 | `incidentCsv.test.ts`, `incidentsExport.api.test.ts` |
| (a) | CA-07.4 | T1, T3, T6 | `incidentCsv.test.ts`, `incidentsExport.api.test.ts` |
| (a) | CA-07.6 | T1, T3, T6 | `incidentCsv.test.ts`, `incidentsExport.api.test.ts` |
| (b) Operador autenticado | — (RA-07-01, diferido) | — | — |
| Alcance por robot (sustituto de b) | CA-07.2 | T4, T5, T6 | `incidentExportService.test.ts`, `incidentsExport.api.test.ts` |
| (c) Escape | CA-07.3 | T2, T3 | `incidentCsv.test.ts` |
| (c) Fórmulas | CA-07.9 | T2, T3 | `incidentCsv.test.ts` |
| (d) Nombre con fecha | CA-07.5 | T4, T5, T6, T7 | `incidentExportService.test.ts`, `incidentsExport.api.test.ts` |
| Validación | CA-07.7 | T6, T7 | `incidentsExport.api.test.ts` |
| Solo lectura / sin auditoría | CA-07.8 | T4, T5, T6 | `incidentExportService.test.ts`, `incidentsExport.api.test.ts` |
| UI descarga | CA-07.10 | T0, T8–T12 | `IncidentsPage.test.tsx`, `incidents.spec.ts` |
| UI sin transformación | CA-07.11 | T8, T9, T10 | `IncidentsPage.test.tsx` |
| UI carga | CA-07.12 | T8, T10, T11 | `IncidentsPage.test.tsx` |
| UI error | CA-07.13 | T8, T9, T10, T11 | `IncidentsPage.test.tsx` |
| HU-06 reservada | CA-07.14 | T0, T8, T11 | `IncidentsPage.test.tsx` |

---

## Notes
- Las tareas 🔴 (T1, T2, T4, T6, T8, T12) van antes de su implementación.
- La UI no genera ni modifica el CSV (RNF-03, P6).
- La exportación no escribe en `incidents` ni en `audit_log`.
- Se habilita solo HU-07; HU-06 sigue reservada.
