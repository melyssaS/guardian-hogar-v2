# Design Document

**Spec:** `006-filter-incidents-by-severity`
**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-06
**Estado:** Borrador rev2 — corregido tras la revisión del analista-requisitos; pendiente de nueva revisión y de aprobación humana (aprobador y fecha: por registrar)

## Overview

El operador elige una severidad en la vista "Incidentes". La UI envía
`GET /api/incidents?severity=<S>`; el backend valida con Zod, filtra en el repositorio y responde. La UI
solo pinta. Flujo vertical: frontend → API → dominio (esquema y regla pura) → repositorio (solo lectura).

```
IncidentsPage ── useIncidents(severity) ──GET /api/incidents?severity=──▶ incidentRoutes
 (selector +                              validate(incidentListQuerySchema, 'query', toError por primer issue)
  Restablecer)                                         ▼
                                       incidentController.list  (solo transporta robotId y severity)
                                         └─ incidents.findAll({ robotId?, severity? })
                                              ├─ SELECT (sin cambios de SQL)
                                              ├─ map(toIncident)   ← añade severity = severityForDecision(code)
                                              └─ filter(i => i.severity === severity)
```

## Decisiones de diseño

| ID | Decisión | Justificación |
|----|----------|---------------|
| DD-601 | Severidad **derivada**, no persistida: `severityForDecision(code)` pura en `domain/src/rules/catalog.ts`, junto a `ruleForDecision`. | Sin migración; registro append-only (spec 002 R5.4); cubre filas antiguas. KISS/YAGNI. |
| DD-602 | **Resuelta:** el mapeo es `Record<Exclude<IncidentCode,'AUTHORIZED'\|'SAFE_STOP_ACTIVE'\|'BUSY'>, Severity>` (tabla de requirements §3.1). La firma acepta `IncidentCode` y **lanza error** ante los 3 códigos sin incidente. `toIncident` propaga el error (como ya hace con `rule`); nunca devuelve `undefined`, que el filtro excluiría en silencio. La prueba de la tarea 1 lo fija. | Evita inventar severidad; TypeScript exige cubrir los 7 códigos. |
| DD-603 | `Severity` y `severitySchema = z.enum(['LOW','MEDIUM','HIGH','CRITICAL'])` en `@home-guardian/domain`; `incidentListQuerySchema` gana `severity: severitySchema.optional()`, sin `.strict()`. Mismos valores y orden que el enum histórico de `architecture.md` (que no se modifica). | Reutiliza el esquema existente; parámetros desconocidos ignorados. |
| DD-604 | **Estricto:** solo mayúsculas exactas; `''`, minúsculas, repetido, array y objeto fallan. **Un solo esquema** con ambos parámetros (el `validate` reasigna `req.query = result.data` y Zod quita las claves desconocidas, así que dos middlewares perderían parámetros). El `toError` de la ruta decide por el **primer issue**: si su ruta es `severity` → `invalidSeverityFilter`; si no → `validationError` (por defecto). `robotId` va primero en el esquema, así que gana cuando ambos son inválidos. | Conserva `incidents.api.test.ts:96` (`robotId` inválido → `VALIDATION_ERROR`) y el patrón de `validate(schema, source, toError)`. |
| DD-605 | `validate.ts` **no cambia**; `toError` recibe el `message` ya compuesto como `"<path>: <mensaje>"`, por lo que la ruta decide con `message.startsWith('severity')`. | Sin tocar middleware compartido. |
| DD-606 | **El filtro vive en el repositorio:** `IncidentFilter` gana `severity?`; `findAll` mapea con `toIncident` y luego filtra. El controlador solo transporta `{ robotId, severity }`, conforme a su contrato ("solo recibe y responde", SOLID-S). | La lógica no se parte entre capas; la severidad no es columna. |
| DD-607 | `Incident` e `IncidentDetail` ganan `severity: Severity` (aditivo). | Permite insignia y verificación en cualquier capa. |
| DD-608 | `incidentsApi.list(robotId?, severity?)` (**no** se quita `robotId`); añade `?severity=` solo con valor. `useIncidents` gana `{ severity, setSeverity, resetSeverity }`; cada instancia del hook tiene su **propio** estado de filtro, de modo que `SimulationPage` (que usa `useIncidents` para indicadores) no se ve afectado. Descarta respuestas obsoletas (gana la **última emitida**, contador de petición) y mantiene lista y severidad activa anteriores mientras carga o si falla. | Compatibilidad; CA-06.8 y CA-06.9. Sin debounce (es un selector). |
| DD-609 | **Severidad activa** = la de la última petición completada con éxito. Lista vacía: con activa → "No hay incidentes de severidad {S}." (`role="status"`); sin activa → mensaje actual. `IncidentTable` recibe `emptyMessage` decidido por la página. | CA-06.4. |
| DD-610 | Control `IncidentSeverityFilter`: `<select>` con etiqueta "Filtrar por severidad" y opciones "Todas" + `SEVERITY_OPTIONS`; botón "Restablecer filtro" (deshabilitado sin filtro). "Todas" ≡ restablecer. Sustituye al botón deshabilitado HU-06. La `note-line` pasa a "HU-07 reservada, no implementada." | Marcador reservado indicado por el humano. |
| DD-611 | **Sin columna nueva:** la severidad se muestra como insignia dentro de la columna "Decisión" (junto al código). Las cabeceras no cambian y spec 003 R9.1 sigue vigente. *(Propuesta por validar; alternativa: columna nueva, que exigiría cambiar R9.1 y `IncidentsPage.test.tsx:80`.)* | Evita contradecir 003 R9.1 y una prueba existente. |
| DD-612 | `SEVERITY_OPTIONS: readonly Severity[]` es una **constante local** del frontend (solo `import type` de `Severity`; la UI no importa reglas). Una prueba la compara con `severitySchema.options` para impedir deriva. | Respeta "la UI no importa reglas" (003) y evita duplicación silenciosa. |
| DD-613 | Contador = incidentes mostrados; el detalle es independiente del filtro y se mantiene visible (requirements RF-06.7). | CA-06.10; la UI no recalcula nada. |
| DD-614 | Sin migraciones ni cambios de BD. | Solo lectura. |

## Archivos a tocar

| Capa | Archivo | Cambio |
|------|---------|--------|
| Dominio | `packages/domain/src/rules/catalog.ts` | `Severity`, `severityForDecision` |
| Dominio | `packages/domain/src/models/guardian.ts` | `severity` en `Incident` |
| Dominio | `packages/domain/src/schemas/incident.schema.ts` | `severitySchema`, `severity?` en `incidentListQuerySchema` |
| Dominio | `packages/domain/src/index.ts` | exportar |
| Backend | `packages/backend/src/repositories/incidentRepository.ts` | `IncidentFilter.severity`, `toIncident` añade `severity`, `findAll` filtra |
| Backend | `packages/backend/src/errors/AppError.ts` | `invalidSeverityFilter` |
| Backend | `packages/backend/src/routes/incidentRoutes.ts` | `toError` por primer issue |
| Backend | `packages/backend/src/controllers/incidentController.ts` | `list` pasa `severity` al repositorio |
| Frontend | `packages/frontend/src/api/client.ts` | `incidentsApi.list(robotId?, severity?)` |
| Frontend | `packages/frontend/src/hooks/useIncidents.ts` | filtro, reset, descarte de obsoletas |
| Frontend | `packages/frontend/src/components/IncidentSeverityFilter.tsx` (nuevo) | selector, "Restablecer filtro", `SEVERITY_OPTIONS` |
| Frontend | `packages/frontend/src/components/IncidentTable.tsx` | insignia en "Decisión" y `emptyMessage` |
| Frontend | `packages/frontend/src/pages/IncidentsPage.tsx` | integra el filtro en el marcador HU-06 |
| Pruebas existentes (excepciones) | `IncidentsPage.test.tsx` (CA-03.27 y fixtures :19,:34), `incidents.api.test.ts:66`, `incidentController.test.ts:8`, `SimulationPage.test.tsx:519` | ver requirements §6 |
| Docs (aprobación humana, art. XIII) | spec 002 §6; spec 003 §5 (catálogo de errores), R9 criterio 4 y las demás referencias a HU-06 deshabilitada (requirements ~232, 518-519, 582-583, 619; design ~326, 610; tasks ~325); `.kiro/steering/mada.md` (backlog), `.kiro/steering/frontend.md` (líneas 65-74) | salida de la reserva y error nuevo |

No se tocan: vigilante, reglas críticas, migraciones, `robot_state`, `audit_log`, `validate.ts`, `SimulationPage.tsx`, `architecture.md`.

## Contrato interno

```ts
// domain
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const severitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export function severityForDecision(code: IncidentCode): Severity; // lanza ante AUTHORIZED | SAFE_STOP_ACTIVE | BUSY
incidentListQuerySchema = z.object({ robotId: …optional(), severity: severitySchema.optional() }); // robotId primero
// backend
interface IncidentFilter { robotId?: RobotId; severity?: Severity }
// frontend
incidentsApi.list(robotId?: number, severity?: Severity): Promise<Incident[]>
```

## Manejo de errores

| Situación | Resultado |
|-----------|-----------|
| `severity` inválida (primer issue en `severity`) | `422 { code: 'INVALID_SEVERITY_FILTER', message }`; la UI usa el callout existente |
| `robotId` inválido (con o sin `severity` inválida) | `422 VALIDATION_ERROR` (sin cambios) |
| Fallo de red | callout de error existente; se conservan lista y severidad activa |

## Riesgos

- **Campo nuevo:** rompe `toEqual` y fixtures tipados (excepciones en requirements §6); los ajustes se hacen en la tarea que provoca la rotura para no dejar la suite en rojo entre tareas.
- **Express:** el backend usa Express 4 (`^4.21`), donde `validate.ts` puede reasignar `req.query`; sin cambios aquí. `severity[]=HIGH` y `severity=A&severity=B` llegan como array y fallan el enum.
- **Mapeo por validar:** si el humano cambia §3.1, solo cambian la tabla, DD-602 y la prueba de la tarea 1.
