# Design Document

**Spec:** `007-export-incidents-csv`
**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-07
**Contexto:** demo en vivo, responsable Melyssa
**Estado:** **Aprobado** por el humano (2026-11-24), revisión 2 (tras informe del analista-requisitos)

## Overview

Exportación CSV de solo lectura sobre el contrato de `GET /api/incidents` (spec 002 §6). Flujo
vertical: backend (codificador puro → servicio → controller → ruta) → frontend (cliente HTTP →
hook → botón). El dominio compartido **no cambia**: se reutilizan `Incident` e
`incidentListQuerySchema`.

Se reutilizan del código actual:
- `IncidentRepository.findAll(filter)`: alcance por `robotId` y orden `id DESC`
  (`incidentRepository.ts`).
- `RobotCatalogRepository.findById`: `404 ROBOT_NOT_FOUND`, como en `incidentController.list`.
- `validate(schema, 'query')`: `422 VALIDATION_ERROR` por defecto (`validate.ts`).
- El limitador general de `/api` en `app.ts`.

---

## Archivos a tocar

### Backend
| Archivo | Cambio | CA |
|---------|--------|----|
| `packages/backend/src/rules/incidentCsv.ts` (nuevo) | Funciones **puras** `INCIDENT_CSV_HEADERS`, `toCsvCell(value, kind)` e `incidentsToCsv(incidents): string`. Aplican BOM, encabezados, `String(n)`, `null` → vacío, mitigación de fórmulas, escape RFC 4180 y `\r\n`. | 07.1, 07.3, 07.4, 07.6, 07.9 |
| `packages/backend/src/services/incidentExportService.ts` (nuevo) | `createIncidentExportService({ incidents, catalog, now })` con `exportCsv(filter)`, que devuelve `{ filename, body }`. Lanza `robotNotFound` si el robot no existe. `now: () => Date` se inyecta (SOLID-D). | 07.2, 07.5, 07.8 |
| `packages/backend/src/controllers/incidentController.ts` | Handler `exportCsv`: fija `Content-Type` y `Content-Disposition: attachment; filename="…"` y hace `res.send(body)`. Solo recibe y responde. | 07.1, 07.5 |
| `packages/backend/src/routes/incidentRoutes.ts` | `router.get('/export', validate(incidentListQuerySchema, 'query'), c.exportCsv)`, **antes** de `/:id`. | 07.7 |
| `packages/backend/src/app.ts` | `cors({ origin, exposedHeaders: ['Content-Disposition'] })`; inyecta el servicio de exportación con `now: () => new Date()`. | 07.5 |

### Frontend
| Archivo | Cambio | CA |
|---------|--------|----|
| `packages/frontend/src/api/client.ts` | `requestBlob(path): Promise<{ blob, filename }>`, que comparte con `request` el manejo de errores: `NETWORK_ERROR`, y si `!res.ok` parsea `{ code, message }` y lanza `ApiError`. Lee `filename` de `Content-Disposition`, con `incidentes.csv` como respaldo. Añade `incidentsApi.exportCsv()` sin parámetros. | 07.10, 07.11, 07.13 |
| `packages/frontend/src/hooks/useIncidents.ts` | Nueva operación `'export'` en `status` y acción `exportCsv()`. Crea la URL del blob con `URL.createObjectURL` solo si hay éxito, hace clic en un `<a download>` temporal y llama a `revokeObjectURL`. | 07.10–07.13 |
| `packages/frontend/src/pages/IncidentsPage.tsx` | El botón HU-07 se habilita: `disabled={status.export.loading}`, con el texto "Exportando…" mientras carga, y el error se muestra en el `role="alert"` existente. El botón HU-06 queda igual, con el comentario `{/* HU-06: filtrar por severidad — reservado para demo en vivo */}`. La nota pasa a "HU-06 está reservada, no implementada." | 07.10–07.14 |

### Otras specs y pruebas existentes
| Archivo | Cambio |
|---------|--------|
| `.kiro/specs/003-movement-simulation/requirements.md` | RF-09.4 / CA-03.27: marcar HU-07 como "Sustituido por 007 CA-07.10" y añadir una entrada al §12. |
| `packages/frontend/tests/components/IncidentsPage.test.tsx` | La prueba `CA-03.27` deja de afirmar que HU-07 está `disabled` y solo afirma HU-06 (CA-07.14). |

---

## Flujo

```
IncidentsPage ─click─► useIncidents.exportCsv() ─► incidentsApi.exportCsv()
  ─► requestBlob('/api/incidents/export')
     ─► GET /api/incidents/export
        validate(incidentListQuerySchema,'query')      → 422 VALIDATION_ERROR
        incidentController.exportCsv
          incidentExportService.exportCsv(filter)
            catalog.findById(robotId)                  → 404 ROBOT_NOT_FOUND
            incidents.findAll(filter)                  (orden id DESC)
            incidentsToCsv(incidents)                  (puro)
            filename = incidentes-${now() UTC YYYY-MM-DD}.csv
        200 text/csv; charset=utf-8 + Content-Disposition
  ◄─ { blob, filename } ─► <a download> ─► archivo
  ◄─ ApiError ─► role="alert", sin descarga
```

---

## Codificador `incidentsToCsv` (puro)

1. **Columnas** en orden fijo: `id, robotId, robotName, rule, zoneName, decisionCode,
   collisionType, stateAfter, originX, originY, destX, destY, reason, createdAt`.
2. **Valores:** los números con `String(n)` y `null` como `''`. `createdAt` se copia tal cual (ISO-8601).
3. **Mitigación de fórmulas** (solo en texto libre: `robotName`, `zoneName`, `reason`): si el
   valor empieza por `=`, `+`, `-`, `@`, `\t` o `\r`, se le antepone `'`.
4. **Escape RFC 4180** (sobre el valor ya mitigado): si contiene `,`, `"`, `\n` o `\r`, se
   entrecomilla y se duplica cada `"`.
5. **Salida:** `'\uFEFF' + [encabezados, ...filas].join('\r\n')`.

## Nombre de archivo
`incidentes-${now().toISOString().slice(0, 10)}.csv`. Lo genera el servicio con el reloj
inyectado y el controller lo pone entre comillas en `Content-Disposition`.

---

## Decisiones de diseño

| Decisión | Alternativa descartada | Justificación |
|----------|------------------------|---------------|
| El codificador va en `backend/src/rules/` | En `@home-guardian/domain` | El dominio es para tipos y contratos compartidos. Si el codificador estuviera ahí, el frontend podría importarlo (RNF-03, M-5). `rules/` aloja funciones puras. |
| Reutilizar `incidentListQuerySchema` | Un esquema nuevo idéntico | YAGNI (M-8). Así el alcance es el mismo por construcción. |
| BOM UTF-8 | Sin BOM | Decisión humana (I-5): Excel muestra bien los acentos. |
| Prefijo `'` en texto libre | Aceptar el riesgo | Decisión humana (I-6, OWASP CSV Injection). Al reparsear, la celda recupera el valor **con** el prefijo. |
| No auditar la exportación | Una fila en `audit_log` | Decisión humana: la exportación no es una transición de estado ni un rechazo. |
| `now` inyectado | `new Date()` dentro del servicio | Las pruebas son deterministas (I-8). |
| `requestBlob` en `client.ts` | Un `fetch` suelto en el hook | Todas las llamadas pasan por un único cliente con el mismo manejo de errores (I-4). |
| `exposedHeaders: ['Content-Disposition']`, con `incidentes.csv` como respaldo | Confiar en el proxy | En Render el frontend y la API tienen orígenes distintos (I-3). El respaldo no calcula fechas en el cliente. |
| `/export` antes de `/:id` | El orden actual | Si no, `export` se valida como `:id` y responde 422. |
| Alcance = `robotId`, sin operador | Inventar un propietario | RA-07-01 (aceptado). No existe propietario en el modelo de datos ni autenticación. |

---

## Correctness Properties

- **P1 — Encabezados estables:** la primera línea tras el BOM es siempre `INCIDENT_CSV_HEADERS` (CA-07.1).
- **P2 — Mismo alcance:** `ids(export(f)) = ids(list(f))` para cualquier filtro `f` válido (CA-07.2).
- **P3 — Round-trip:** al reparsear con RFC 4180 se obtienen 14 columnas por fila. Cada celda
  recupera su valor, mitigado si empezaba por un carácter de fórmula (CA-07.3, CA-07.9).
- **P4 — UTF-8 íntegro:** `TextDecoder('utf-8', { fatal: true })` no falla y conserva `é` (CA-07.4).
- **P5 — Solo lectura:** el número de filas en `incidents` y en `audit_log` no cambia al exportar (CA-07.8).
- **P6 — La UI no transforma:** el `Blob` descargado es el recibido (CA-07.11).

---

## Testing Strategy

| Nivel | Archivo | CA |
|-------|---------|----|
| Unit (Vitest) | `packages/backend/tests/unit/incidentCsv.test.ts` | 07.1, 07.3, 07.4, 07.6, 07.9 |
| Unit (Vitest) | `packages/backend/tests/unit/incidentExportService.test.ts` | 07.2, 07.5, 07.8 |
| Integración (Supertest, SQLite `:memory:`) | `packages/backend/tests/integration/incidentsExport.api.test.ts` | 07.1, 07.2, 07.4–07.8 |
| Componentes (RTL) | `packages/frontend/tests/components/IncidentsPage.test.tsx` | 07.10–07.14 |
| E2E (Playwright) | `packages/frontend/tests/e2e/incidents.spec.ts` | 07.10 |

---

## Dependencias entre HU
- Depende de la bitácora de incidentes (spec 002 §6) y de la vista "Incidentes" (spec 003 RF-09).
- Independiente de HU-06, que sigue reservada.

## Compuerta Fase 2 (DISEÑAR)
El humano aprueba estos archivos y decisiones antes de pasar a CONSTRUIR.
