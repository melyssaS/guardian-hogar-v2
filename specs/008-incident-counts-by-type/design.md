# Design Document

**Spec:** `008-incident-counts-by-type`
**Fase MADA:** DISEÑAR
**HU cubiertas:** HU-08
**Estado:** Borrador (pendiente de aprobación humana)

> Define **cómo** se implementa lo descrito en `requirements.md`, respetando la arquitectura
> del repo: capas `routes → controllers → services → repositories`, lógica en el backend,
> validación con Zod, tipos compartidos en `@home-guardian/domain`, UI solo de presentación.

---

## 1. Resumen de la solución

Se añade un endpoint de solo lectura `GET /api/incidents/counts` que agrega los incidentes por
su `rule` (el "tipo") y devuelve un conteo por cada categoría del catálogo más el total. El
cálculo es una **función pura del dominio** que recibe la lista de incidentes y devuelve el
resumen; el backend la invoca con los incidentes del repositorio append-only. La UI consume el
endpoint en la vista "Incidentes" y muestra los números en el marcador reservado de la HU-08.

Decisión central: **"tipo" = `rule`** (catálogo del dominio). Es estable, legible y no se
solapa con severidad (HU-06).

---

## 2. Componentes y archivos a tocar

### Dominio — `@home-guardian/domain`
| Archivo | Cambio |
|---------|--------|
| `packages/domain/src/models/incidentCounts.ts` **(nuevo)** | Tipos/forma del resultado: `IncidentTypeCount` (`rule`, `title`, `count`) e `IncidentCounts` (`total`, `byType`). Van en `models/` (no en `schemas/`) porque son tipos sin Zod, junto a `Incident` (H-3). |
| `packages/domain/src/rules/incidentCounts.ts` **(nuevo)** | Función pura `countIncidentsByType(incidents: readonly Incident[]): IncidentCounts`. Itera el catálogo `RULES` (orden fijo), cuenta por `rule`, calcula `total`. Determinista y sin efectos. |
| `packages/domain/src/index.ts` | Exportar los nuevos tipos y la función. |

> No se necesita Zod de *entrada* para el nuevo endpoint (no recibe body ni query; el único
> parámetro reutilizable sería `robotId`, que **queda fuera de alcance** en esta HU, DD-08.6).
> La forma de *salida* se tipa con TypeScript. Por eso los tipos van en `models/`, no en
> `schemas/`: la carpeta `schemas/` se reserva para esquemas Zod de validación (convención del
> repo); un `*.schema.ts` sin Zod sería engañoso (H-3).

### Backend — `@home-guardian/backend`
| Archivo | Cambio |
|---------|--------|
| `packages/backend/src/controllers/incidentController.ts` | Añadir handler `counts(req, res)`: lee `incidents.findAll({})`, llama a `countIncidentsByType`, responde el resumen. Sin lógica de conteo en el controlador (delega al dominio). |
| `packages/backend/src/routes/incidentRoutes.ts` | Registrar `router.get('/counts', c.counts)` **antes** de `router.get('/:id', …)` para que `:id` no capture `counts`. |

> El repositorio `IncidentRepository.findAll` ya existe y devuelve todos los incidentes; se
> reutiliza tal cual. No se añade método de repositorio: la agregación es del dominio, no de
> la capa de datos (KISS, YAGNI).

### Frontend — `@home-guardian/frontend`
| Archivo | Cambio |
|---------|--------|
| `packages/frontend/src/api/client.ts` | Añadir `incidentsApi.counts()` → `GET /api/incidents/counts`, tipado con `IncidentCounts` del dominio. |
| `packages/frontend/src/hooks/useIncidents.ts` | Añadir `'counts'` al tipo `IncidentsOperation` (hoy `'list' \| 'detail'`); cargar `incidentsApi.counts()` en `refresh` (que ya corre al montar, CA-08.7) y exponer `counts` y `status.counts`. El error/carga de `counts` se mantiene **aislado** en `status.counts`: NO se fusiona con `status.list`/`status.detail` ni con el callout global de error, para no romper la tabla ni el detalle (H-5, CA-08.9). |
| `packages/frontend/src/components/IncidentCounts.tsx` **(nuevo)** | Componente de presentación: recibe `counts` y el `status.counts` (carga/error) y los pinta (una píldora/tarjeta por tipo con título y número, y el total). El manejo de carga/error de los conteos es **local a este componente** (H-5). Solo muestra; no calcula. |
| `packages/frontend/src/pages/IncidentsPage.tsx` | Sustituir el marcador reservado de HU-08 por `<IncidentCounts counts={…} status={status.counts} />`. La carga/error de conteos la resuelve el propio `IncidentCounts`; el callout global y la tabla/detalle existentes no se tocan (CA-08.9). |
| `packages/frontend/src/types/index.ts` | Reexportar `IncidentCounts`, `IncidentTypeCount` desde el dominio. |

---

## 3. Decisiones de diseño

| ID | Decisión | Alternativa descartada | Justificación |
|----|----------|------------------------|---------------|
| DD-08.1 | "Tipo" = `rule` (catálogo) | Severidad, decisión, zona, robot | `rule` es el catálogo estable del dominio y la lectura natural de "tipo de incidente"; severidad es la HU-06. |
| DD-08.2 | Conteo en el **backend** vía función **pura** del dominio | Contar en el frontend sobre la lista | Art. III y RNF-03: la lógica no vive en la UI; función pura = testeable y determinista (CA-08.5). |
| DD-08.3 | Endpoint nuevo `GET /api/incidents/counts` | Derivar en el cliente desde `GET /api/incidents` | El indicador lo entrega el backend; desacopla la UI del conjunto completo y cumple art. III. |
| DD-08.4 | `byType` incluye siempre las 3 categorías, con 0 si no hay | Omitir categorías vacías | CA-08.3: vista estable y comparable; "muestra cero", no "oculta". |
| DD-08.5 | `/counts` se registra antes de `/:id` | Dejar el orden actual | `:id` usa `z.coerce.number()`; "counts" no es número, pero el orden explícito evita cualquier ambigüedad de rutas. |
| DD-08.6 | Sin filtro `robotId` en esta HU | Aceptar `?robotId=` | YAGNI: la HU pide "consulta completa de incidentes" (CA-08.2); añadir filtro duplicaría semántica y pruebas sin pedirlo la HU. |
| DD-08.7 | Reutilizar `IncidentRepository.findAll({})` | Nueva query SQL `GROUP BY rule` | KISS: el volumen es de demo; una función pura sobre la lista es más simple, más fácil de probar y evita SQL nuevo. Si el volumen creciera, se podría mover a SQL sin cambiar el contrato. |
| DD-08.8 | Agrupar por `Incident.rule` tal como lo entrega `findAll` | Agrupar por `decisionCode` | `findAll` ya devuelve `rule` resuelta (para filas legadas la deriva con `ruleForDecision`); el conteo opera sobre `Incident.rule` normalizado, nunca sobre `decisionCode` (H-6). |
| DD-08.9 | `incidentsApi.counts()` sin parámetros | Replicar la firma `list(robotId?)` | Coherente con DD-08.6: el conteo es global; el cliente no ofrece filtro (H-7). |

---

## 4. Contrato (resumen; detalle en requirements.md §4)

`GET /api/incidents/counts` → `200`:
```ts
interface IncidentTypeCount { rule: RuleId; title: string; count: number; }
interface IncidentCounts { total: number; byType: IncidentTypeCount[]; } // byType: 3 categorías en orden de catálogo
```

Errores: si ocurre un fallo interno, el `errorHandler` central responde `{ code, message }`
sin stack trace (RNF-04). El endpoint no valida entrada (no recibe parámetros en esta HU).

---

## 5. Seguridad y trazabilidad

- **Solo lectura:** el handler solo hace `findAll` + cálculo puro; no escribe (CA-08.4, RNF-05).
- **Sin secretos, sin `any`, validación en el borde** si se añadiera entrada (RNF-01, RNF-02).
- **helmet / rate-limit / CORS** ya aplican globalmente a `/api` (sin cambios).
- Cadena: `HU-08 → requirements.md (CA-08.x) → design.md → tasks.md → código → pruebas`.

---

## 6. Interacción (flujo)

```
IncidentsPage ──(abre/recarga)──► useIncidents.refresh()
      │                                   │
      │                                   ├─► incidentsApi.list()   GET /api/incidents
      │                                   └─► incidentsApi.counts()  GET /api/incidents/counts
      ▼                                                   │
IncidentCounts (muestra byType + total)  ◄────────────────┘
                                                          │ backend
                              incidentController.counts ──► incidents.findAll({})
                                                          └► countIncidentsByType(...)  (dominio, puro)
```
