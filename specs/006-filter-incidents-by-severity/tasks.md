# Implementation Plan: Filtrar incidentes por severidad (006-filter-incidents-by-severity)

**Fase MADA:** CONSTRUIR
**HU cubiertas:** HU-06
**Estado:** Tareas 1 a 15 implementadas (2026-11-24) por orden expresa del humano; las compuertas humanas de requirements §8 (salida de la reserva, validación de severidades, aprobación) siguen **sin registrar**; pendiente la revisión independiente del revisor-qa-seguridad

## Reglas

- TDD: en cada tarea de código, la **prueba roja se escribe y se ve fallar primero**. Las pruebas de **caracterización** (ya pasan hoy) se rotulan así y no llevan ROJO.
- La suite debe quedar **en verde al final de cada tarea de implementación**; los ajustes a pruebas existentes se hacen en la tarea que provoca la rotura.
- Código en inglés; documentación en español. Sin commit hasta que el humano lo pida.
- Cada tarea cita criterio (CA) y prueba. Fixtures A y B: requirements §5.

## Tasks

- [x] 1. (ROJO) Pruebas de dominio: `severityForDecision` devuelve la severidad de los 7 códigos de §3.1 y **lanza** ante `AUTHORIZED`, `SAFE_STOP_ACTIVE` y `BUSY`; `incidentListQuerySchema` acepta sin `severity` y las 4 válidas, rechaza `high`, `''`, `URGENT`, array y objeto, e ignora parámetros desconocidos
  - _Criterios: CA-06.5, CA-06.6 · `packages/domain/tests/incidentSeverity.test.ts`_
- [x] 2. Implementar `Severity`, `severityForDecision`, `severitySchema`, `severity?` en el esquema y `severity` en `Incident`/`IncidentDetail`; exportar desde `index.ts`. **Ajuste mecánico** de los fixtures tipados `Incident` (`incidentController.test.ts:8`, `IncidentsPage.test.tsx:19,34`, `SimulationPage.test.tsx:519`) para que `typecheck` siga en verde
  - _Criterios: CA-06.5, CA-06.6, CA-06.9_
- [x] 3. (ROJO) Pruebas del repositorio: `findAll` y `findById` devuelven `severity` correcta (fixture A, incluida una fila anterior a la migración 009); `findAll({ severity })` filtra, conserva el orden descendente y se combina con `robotId`; severidad sin incidentes → `[]`
  - _Criterios: CA-06.1, CA-06.6, CA-06.7 · `packages/backend/tests/unit/incidentRepository.test.ts` (bloque nuevo)_
- [x] 4. Implementar `IncidentFilter.severity`, `severity` en `toIncident` y el filtrado en `findAll`. **Ajustar** `incidents.api.test.ts:66` (`toEqual` del incidente completo → incluye `severity`)
  - _Criterios: CA-06.1, CA-06.6, CA-06.7, CA-06.9_
- [x] 5. (ROJO) Pruebas de integración (Supertest) `GET /api/incidents`: fixtures A y B; cada severidad devuelve lo esperado y `HIGH` trae 2 en orden descendente; `LOW` con fixture B → `200 []`; sin `severity` → los 5; inválidos (`high`, vacío, `URGENT`, repetido, `severity[]=`) → 422 `INVALID_SEVERITY_FILTER` con `{ code, message }`; `?_=1` → 200; `?robotId=1&severity=HIGH`; `?robotId=abc` y `?robotId=abc&severity=URGENT` → 422 `VALIDATION_ERROR`; `?robotId=999&severity=HIGH` → 404; `GET /:id` trae `severity`
  - _Criterios: CA-06.1, CA-06.4 (API), CA-06.5, CA-06.6, CA-06.7, CA-06.9 · `packages/backend/tests/integration/incidentsSeverity.api.test.ts`_
- [x] 6. (CARACTERIZACIÓN, pasa antes y después) Solo lectura: volcar `incidents`, `audit_log`, `robots`, `robot_state` y `robot_sessions` antes y después de filtrar con y sin resultados y de pedir sin filtro; deben ser idénticos; `POST/PUT/PATCH/DELETE /api/incidents` → 404
  - _Criterios: CA-06.3 · `incidentsSeverity.api.test.ts` (bloque "no modifica")_
- [x] 7. (ROJO) Prueba unitaria del controlador: `list` pasa `{ robotId, severity }` al repositorio y no filtra por su cuenta; sin parámetros pasa `{}`
  - _Criterios: CA-06.1, CA-06.7 · `packages/backend/tests/unit/incidentController.test.ts` (bloque nuevo)_
- [x] 8. Añadir `invalidSeverityFilter` en `AppError.ts`, cablear en `incidentRoutes.ts` el `toError` por primer issue (DD-604/605) y pasar `severity` desde `incidentController.list` (hacen pasar 5 y 7; `incidents.api.test.ts:96` debe seguir en verde sin cambios)
  - _Criterios: CA-06.1, CA-06.5, CA-06.7_
- [x] 9. (ROJO) Pruebas de `incidentsApi.list` y `useIncidents`: sin filtro pide exactamente `/api/incidents` (y `list(robotId)` sigue funcionando); con filtro añade `?severity=HIGH`; `resetSeverity` vuelve a pedir sin parámetro; respuesta obsoleta descartada (gana la última emitida); mantiene lista y severidad activa durante la carga y ante error; cada instancia del hook tiene su propio filtro
  - _Criterios: CA-06.2, CA-06.8, CA-06.9 · `packages/frontend/tests/components/useIncidentsFilter.test.tsx`_
- [x] 10. (ROJO) Pruebas de componentes (RTL) de `IncidentsPage`/`IncidentSeverityFilter`: etiqueta "Filtrar por severidad"; opciones = "Todas" + `severitySchema.options` (importado solo en la prueba); elegir `HIGH` muestra exactamente lo devuelto por la API aunque no coincida; vacío con filtro → "No hay incidentes de severidad LOW." con `role="status"`, "0 eventos" y sin "Sin incidentes registrados…"; sin filtro y vacío → mensaje actual; "Todas" y "Restablecer filtro" muestran todos; "Restablecer filtro" deshabilitado sin filtro; contador = mostrados y detalle visible tras filtrar (CA-06.10); la UI solo emite `GET`; fallo → callout y lista previa; cabeceras sin cambios y botón HU-07 deshabilitado; `SimulationPage` sigue pidiendo `/api/incidents` sin `severity`
  - _Criterios: CA-06.2, CA-06.3, CA-06.4, CA-06.8, CA-06.9, CA-06.10, CA-06.11 · `packages/frontend/tests/components/IncidentSeverityFilter.test.tsx`_
- [x] 11. (ROJO) E2E (Playwright) `incident-severity.spec.ts`, escrito **antes** de la UI y visto fallar, con incidentes provocados por la propia prueba (sin depender del seed): filtrar por una severidad muestra solo esas filas; una severidad sin incidentes muestra el estado vacío; "Restablecer filtro" restaura el conteo inicial; el listado completo tras filtrar es idéntico al inicial
  - _Criterios: CA-06.1, CA-06.2, CA-06.3, CA-06.4 · `packages/frontend/tests/e2e/incident-severity.spec.ts`_
- [x] 12. Implementar `incidentsApi.list(robotId?, severity?)`, filtro en `useIncidents`, `IncidentSeverityFilter.tsx` (con `SEVERITY_OPTIONS`), insignia y `emptyMessage` en `IncidentTable`, e integrar en `IncidentsPage` en el marcador HU-06 (note-line: "HU-07 reservada, no implementada."); **actualizar** `IncidentsPage.test.tsx` CA-03.27 (hacen pasar 9, 10 y 11)
  - _Criterios: CA-06.2, CA-06.4, CA-06.8, CA-06.9, CA-06.10, CA-06.11_
- [x] 13. Regresión: correr `incidents.api.test.ts` (incl. :96), `incidentRepository.test.ts`, `incidentsMigration.test.ts`, `guardianSchemas.test.ts`, `IncidentsPage.test.tsx` (incl. :80), `App.test.tsx` y `SimulationPage.test.tsx`; solo se admiten las excepciones de requirements §6
  - _Criterios: CA-06.9_
- [x] 14. Documentación (**requiere decisión humana registrada**, art. XIII): `INVALID_SEVERITY_FILTER` en spec 002 §6 y en el catálogo de errores de 003 §5; actualizar 003 R9 criterio 4 y las demás referencias a HU-06 deshabilitada (lista en design "Archivos a tocar"); `mada.md` (backlog) y `frontend.md` (HU-06 sale de las reservadas y de los placeholders)
  - _Criterios: requirements §1.1, §4, §8_
- [x] 15. Calidad: `lint`, `typecheck`, `format` y suite completa en verde; sin secretos ni datos personales
  - _Criterios: compuerta de oro (todos los CA-06.x con prueba)_

## Notas de implementación (desviaciones reales)

- **Prueba roja vista antes de implementar** (conteos reales): tarea 1 → 19 fallan / 4 pasan (23); tarea 3 → 4 / 12 (16); tareas 5 y 6 → 5 / 7 (12; las 2 de caracterización pasan, como se esperaba); tarea 7 → 2 / 5 (7); tarea 9 → 8 / 0 (8); tarea 10 → 10 / 1 (11); tarea 11 → E2E falla esperando el selector «Filtrar por severidad».
- **Tarea 6:** es de caracterización (pasa antes y después), sin ROJO, tal como indica esta lista.
- **Tarea 10:** para que cada caso fallara por separado y no toda la suite por una importación inexistente, se dejó un andamio mínimo de `IncidentSeverityFilter.tsx` (solo `SEVERITY_OPTIONS = []`) que la tarea 12 reemplazó por el componente real.
- **Tarea 12:** la etiqueta visible del selector es «Filtrar por severidad» (sin `aria-label` duplicado). La insignia de severidad va dentro de la columna «Decisión» (DD-611); las cabeceras no cambian.
- **Tarea 14:** se actualizaron 002 (requirements y design, tabla de errores), 003 (requirements R9.4, CA-03.27, alcance, tabla de errores y mapa de vistas; design; tasks RC-16), `mada.md`, `frontend.md` y `backend.md`. Las menciones a «HU-06» de la spec 002 sobre sensores **no** se tocaron (otra cosa). `architecture.md` no se modifica (DD-603). Estas ediciones a specs aprobadas **requieren la decisión humana de requirements §8**, aún sin registrar.
- **Entorno:** en esta máquina Vitest falla con `Cannot read properties of undefined (reading 'config')` si el directorio de trabajo usa `c:\` en minúscula (dos copias de `@vitest/runner`); las pruebas se ejecutaron desde PowerShell con `C:\`. No afecta al código ni a CI.

## Trazabilidad criterio → tarea → prueba

| Criterio | Tareas | Prueba |
|----------|--------|--------|
| CA-06.1 | 3, 4, 5, 7, 8, 11 | `incidentRepository.test.ts`, `incidentsSeverity.api.test.ts`, `incidentController.test.ts`, `incident-severity.spec.ts` |
| CA-06.2 | 9, 10, 11, 12 | `useIncidentsFilter.test.tsx`, `IncidentSeverityFilter.test.tsx`, `incident-severity.spec.ts` |
| CA-06.3 | 6, 10, 11 | `incidentsSeverity.api.test.ts` (bloque "no modifica"), `IncidentSeverityFilter.test.tsx`, `incident-severity.spec.ts` |
| CA-06.4 | 5, 10, 11, 12 | `incidentsSeverity.api.test.ts`, `IncidentSeverityFilter.test.tsx`, `incident-severity.spec.ts` |
| CA-06.5 | 1, 2, 5, 8 | `incidentSeverity.test.ts`, `incidentsSeverity.api.test.ts` |
| CA-06.6 | 1, 2, 3, 4, 5 | `incidentSeverity.test.ts`, `incidentRepository.test.ts`, `incidentsSeverity.api.test.ts` (lista y detalle) |
| CA-06.7 | 3, 4, 5, 7, 8 | `incidentRepository.test.ts`, `incidentsSeverity.api.test.ts`, `incidentController.test.ts` |
| CA-06.8 | 9, 10, 12 | `useIncidentsFilter.test.tsx`, `IncidentSeverityFilter.test.tsx` |
| CA-06.9 | 2, 4, 5, 9, 10, 12, 13 | `incidentsSeverity.api.test.ts`, `IncidentsPage.test.tsx`, `useIncidentsFilter.test.tsx` y suites existentes |
| CA-06.10 | 10, 12 | `IncidentSeverityFilter.test.tsx` |
| CA-06.11 | 10, 12 | `IncidentSeverityFilter.test.tsx` |
| RNF-06.1 | 10 | `IncidentSeverityFilter.test.tsx` |
| RNF-06.2 | 10 | `IncidentSeverityFilter.test.tsx` (texto de UI) |

## Compuerta Fase 3 (CONSTRUIR)

- [ ] Decisión humana de salida de la reserva registrada, tabla de severidades validada, ediciones a specs aprobadas aceptadas y spec aprobada (condición previa).
- [ ] Tareas 1 a 15 completas y cada CA-06.x con al menos una prueba pasando.
