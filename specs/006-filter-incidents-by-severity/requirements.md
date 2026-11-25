# Requirements Document

**Spec:** `006-filter-incidents-by-severity`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-06 (Consultas — "Filtrar incidentes por severidad")
**Estado:** Borrador rev2 — corregido tras la revisión del analista-requisitos (3 bloqueantes, 9 mayores, 8 menores); pendiente de nueva revisión y de aprobación humana (aprobador y fecha: por registrar)

> Trazabilidad: HU-06 → requirements.md → design.md → tasks.md → código → pruebas.
> Este documento captura **qué** debe hacer el sistema, no **cómo**.

---

## 1. Historia de usuario

### HU-06 — Filtrar incidentes por severidad
> Como **operador**, quiero **filtrar la lista de incidentes por severidad (LOW, MEDIUM, HIGH,
> CRITICAL)**, para **encontrar rápidamente los eventos que requieren atención**.

**Dominio:** Consultas (vista "Incidentes", spec 003 R9, sobre `GET /api/incidents` de la spec 002 §6).

### 1.1 Salida de la reserva
HU-06 figura como **"Reservada demo"** (responsable: Sergio) en `.kiro/steering/mada.md`, y
`frontend.md` y la spec 003 exigen dejarla como botón deshabilitado. Esta spec existe porque el
humano pidió redactarla y usarla en ese marcador (`IncidentsPage.tsx`, botón "Filtrar por severidad ·
HU-06 ⌛"). **El registro formal de quién y cuándo decidió sacarla de la reserva queda pendiente** y es
condición de la compuerta §8. Hasta entonces **no se inicia CONSTRUIR**.

> **No confundir:** la spec 002 (§R6, migración 005) llama "HU-06" a otra cosa (lecturas de
> posición/sensores del prototipo). Aquí **HU-06 es siempre el filtro por severidad del backlog de
> `mada.md`**.

### 1.2 Hallazgo: la severidad no existe hoy
El modelo `Incident` actual y la tabla `incidents` **no tienen campo de severidad**. El `enum Severity`
de `.kiro/steering/architecture.md` (Prisma) es histórico y no refleja el código (SQLite sin ORM,
art. IX); esta spec **conserva la misma lista de valores en el mismo orden** (LOW < MEDIUM < HIGH <
CRITICAL) y no modifica `architecture.md`. La severidad se **deriva** del código de decisión (DD-601).
La tabla de §3.1 es una **propuesta que el humano debe validar** (art. XIII).

## 2. Alcance

- **En alcance:** severidad derivada por incidente, filtro `severity` en `GET /api/incidents`,
  control de filtro, insignia de severidad y estado vacío en la vista "Incidentes".
- **Fuera de alcance:** filtrar por otros campos, ordenar, paginar, varias severidades a la vez,
  persistir la severidad, exportar (HU-07), conteos (HU-08), y cambios en el vigilante, las reglas
  críticas o la tabla `incidents`. La vista de Supervisión/Simulación **no cambia**.
- **Principios:** la lógica vive en el **backend** y la entrada se valida con **Zod**; la interfaz
  **solo muestra** lo que responde la API (arts. III, VII, X).

## 3. Requisitos

### Requirement 1: Severidad por incidente (RF-06.1)
Cada incidente (resumen y detalle) expone `severity` ∈ {`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`}, calculada
por el backend a partir de su `decisionCode` con una función pura. La función cubre exactamente los 7
códigos que generan incidente; ante un código que no genera incidente (`AUTHORIZED`,
`SAFE_STOP_ACTIVE`, `BUSY`) **lanza error** en lugar de inventar una severidad.

#### 3.1 Propuesta de mapeo (por validar)
| decisionCode | Regla | Severidad | Motivo |
|--------------|-------|-----------|--------|
| `ORIGIN_IN_RESTRICTED_ZONE` | R-ZONA-01 | `CRITICAL` | El robot ya está dentro de una zona restringida. |
| `RESTRICTED_ZONE_VIOLATION` | R-ZONA-01 | `HIGH` | Destino dentro de zona restringida. |
| `ZONE_DATA_UNAVAILABLE` | R-DATA-01 | `HIGH` | No se puede verificar nada; fallo seguro. |
| `TRAJECTORY_CROSSES_ZONE` | R-ZONA-01 | `MEDIUM` | La trayectoria cruzaría la zona; se evitó. |
| `INSUFFICIENT_DATA` | R-SIGNAL-01 | `MEDIUM` | Datos insuficientes para evaluar. |
| `MISSING_POSITION` | R-SIGNAL-01 | `MEDIUM` | Falta la posición. |
| `POSITION_QUALITY_LOST` | R-SIGNAL-01 | `LOW` | Pérdida de señal; operación degradada, sin riesgo geométrico. |

### Requirement 2: Filtro por severidad (RF-06.2)
`GET /api/incidents?severity=<S>` devuelve solo los incidentes de severidad `S`, en el mismo orden
(más reciente primero). Sin `severity` devuelve todos. Se puede combinar con `robotId`.

### Requirement 3: Restablecer (RF-06.3)
El operador quita el filtro con "Restablecer filtro" o eligiendo la opción "Todas"; ambas son
equivalentes y la vista vuelve a mostrar todos los incidentes. "Restablecer filtro" está
deshabilitado mientras no haya filtro activo.

### Requirement 4: Solo lectura (RF-06.4)
Filtrar y restablecer usan únicamente `GET`; no crean, modifican ni eliminan incidentes ni otros
registros (registro append-only, spec 002 R5.4).

### Requirement 5: Estado vacío (RF-06.5)
Si ningún incidente cumple el filtro, la interfaz muestra un mensaje claro con la severidad aplicada,
distinto de "Sin incidentes registrados…". Es texto en el DOM con `role="status"`.

### Requirement 6: Validación (RF-06.6)
`severity` se valida con Zod en el borde: exactamente uno de los cuatro valores en mayúsculas. Cualquier
otro valor (minúsculas, vacío, desconocido, repetido, array, objeto) → `422 INVALID_SEVERITY_FILTER`. Los
parámetros desconocidos se ignoran. Un `robotId` inválido **conserva** su error actual
(`422 VALIDATION_ERROR`); si ambos son inválidos, **decide el primer problema del esquema, que es
`robotId`**, y responde `VALIDATION_ERROR`.

### Requirement 7: Contador y detalle (RF-06.7)
El contador "N eventos" cuenta los incidentes **mostrados** (los de la respuesta); con filtro sin
resultados muestra "0 eventos" junto al mensaje vacío. El panel de detalle depende solo del incidente
elegido (`GET /api/incidents/:id`), no del filtro: sigue visible aunque el filtro excluya ese incidente.

### Requisitos no funcionales
- **RNF-06.1 Accesibilidad:** el selector tiene etiqueta accesible "Filtrar por severidad"; el estado
  vacío usa `role="status"`.
- **RNF-06.2 Idioma:** mensajes de **interfaz** en español; identificadores de código en inglés. El
  `message` de los errores de API es texto libre (como los demás errores); solo se verifica su `code`.

## 4. Contrato de API

`GET /api/incidents?severity=<S>[&robotId=<n>]` (extiende spec 002 §6; ambos parámetros opcionales).

| Caso | Respuesta |
|------|-----------|
| Sin `severity` | `200` todos (más reciente primero), cada uno con `severity` |
| `severity` válida con coincidencias | `200 Incident[]` solo de esa severidad |
| `severity` válida sin coincidencias | `200 []` |
| `severity` inválida (RF-06.6) | `422 { code: 'INVALID_SEVERITY_FILTER', message }` |
| `robotId` inválido (con o sin `severity`) | `422 { code: 'VALIDATION_ERROR', message }` (sin cambios) |
| `robotId` inexistente | `404` existente, sin cambios |
| `GET /api/incidents/:id` | `200` detalle, ahora con `severity` |

`Incident` e `IncidentDetail` ganan `severity` (aditivo). `INVALID_SEVERITY_FILTER` se documenta en
spec 002 §6 (dueña del contrato) y en el catálogo de errores consolidado de spec 003 §5 (tarea 14).

## 5. Criterios de aceptación (Dado / Cuando / Entonces)

**Fixture A** (5 incidentes, ids ascendentes = orden de creación):
robot 1: `ORIGIN_IN_RESTRICTED_ZONE` (CRITICAL), `RESTRICTED_ZONE_VIOLATION` (HIGH), `POSITION_QUALITY_LOST` (LOW);
robot 2: `ZONE_DATA_UNAVAILABLE` (HIGH), `TRAJECTORY_CROSSES_ZONE` (MEDIUM).
**Fixture B** (2 incidentes, sin MEDIUM ni LOW): `ORIGIN_IN_RESTRICTED_ZONE` (CRITICAL), `RESTRICTED_ZONE_VIOLATION` (HIGH).

- **CA-06.1** *(filtro válido)* Dado el fixture A, cuando el operador filtra por `CRITICAL`, `MEDIUM` o
  `LOW`, ve solo el incidente de ese nivel; cuando filtra por `HIGH`, ve exactamente los dos incidentes
  HIGH, el más reciente primero (`ZONE_DATA_UNAVAILABLE` antes que `RESTRICTED_ZONE_VIOLATION`), y ninguno de los otros.
- **CA-06.2** *(restablecer)* Dado el fixture A con un filtro aplicado, cuando el operador pulsa
  "Restablecer filtro" o elige "Todas", entonces ve los 5 incidentes y la interfaz pide
  `/api/incidents` sin `severity`; y sin filtro activo "Restablecer filtro" está deshabilitado.
- **CA-06.3** *(no modifica)* Dado el fixture A, cuando se filtra (con y sin resultados) y se restablece,
  entonces el contenido de las tablas `incidents`, `audit_log`, `robots`, `robot_state` y
  `robot_sessions` es idéntico antes y después; el cliente solo emite `GET`; y `POST/PUT/PATCH/DELETE
  /api/incidents` responden 404.
- **CA-06.4** *(estado vacío)* Dado el fixture B, cuando se filtra por `LOW`, entonces la interfaz muestra
  "No hay incidentes de severidad LOW." con `role="status"`, sin filas, con "0 eventos" y sin el mensaje
  "Sin incidentes registrados…"; y la API responde `200 []`.
- **CA-06.5** *(valor inválido)* Dado `?severity=high`, `?severity=`, `?severity=URGENT`,
  `?severity=HIGH&severity=LOW` o `?severity[]=HIGH`, cuando se llama a la API, entonces responde
  `422 INVALID_SEVERITY_FILTER` con `{ code, message }`.
- **CA-06.6** *(severidad derivada)* Dado cada `decisionCode` de §3.1, cuando se calcula su severidad,
  coincide con la tabla; ante `AUTHORIZED`, `SAFE_STOP_ACTIVE` o `BUSY` la función lanza error; y todo
  incidente de la lista y del detalle (incluida una fila anterior a la migración 009) trae `severity`.
- **CA-06.7** *(combinación)* Dado el fixture A, cuando se pide `?robotId=1&severity=HIGH`, solo vuelve
  `RESTRICTED_ZONE_VIOLATION`; con `?robotId=abc` (con o sin `severity` inválida) responde
  `422 VALIDATION_ERROR`; con `?robotId=999&severity=HIGH` responde `404`.
- **CA-06.8** *(la UI solo muestra)* Dado que la API decide qué incidentes cumplen el filtro, cuando la
  interfaz recibe la respuesta, entonces muestra exactamente esa lista, sin filtrar ni reordenar en el
  cliente; con dos peticiones fuera de orden **gana la última emitida**; y si una petición falla muestra
  el callout de error existente y conserva la lista y la severidad activa anteriores.
- **CA-06.9** *(regresión)* Dado `GET /api/incidents` sin `severity`, cuando se llama, devuelve los mismos
  incidentes y orden que antes más el campo `severity`; la tabla conserva sus cabeceras (spec 003 R9.1:
  la severidad es una insignia dentro de la columna "Decisión"); el botón HU-07 sigue deshabilitado;
  `SimulationPage` sigue recibiendo la lista sin filtrar; y las pruebas existentes siguen en verde salvo
  las **excepciones documentadas** en §6.
- **CA-06.10** *(contador y detalle)* Dado el fixture A con el incidente HIGH seleccionado, cuando se
  filtra por `LOW`, entonces el contador muestra "1 eventos" y el panel de detalle sigue visible.
- **CA-06.11** *(accesibilidad y opciones)* El selector tiene la etiqueta "Filtrar por severidad" y sus
  opciones son "Todas" más exactamente los valores de `severitySchema.options`, en ese orden.

## 6. Dependencias y excepciones a pruebas existentes

- Spec 002 §6 (incidentes, `GET /api/incidents`), spec 001 (catálogo `RULES`) y spec 003 R9 (vista "Incidentes").
- **Excepciones documentadas** (únicos cambios permitidos a pruebas existentes):
  - `IncidentsPage.test.tsx` CA-03.27: el botón HU-06 ya no es un botón deshabilitado.
  - `incidents.api.test.ts:66`: `toEqual` del incidente completo, por el campo `severity`.
  - Fixtures tipados `Incident` sin `severity`: `incidentController.test.ts:8`, `IncidentsPage.test.tsx:19,34`, `SimulationPage.test.tsx:519`.
- Deben seguir en verde sin cambios: `incidents.api.test.ts:96` (`robotId` inválido → `VALIDATION_ERROR`),
  `IncidentsPage.test.tsx:80` (cabeceras), `incidentRepository.test.ts`, `incidentsMigration.test.ts`,
  `guardianSchemas.test.ts`, `App.test.tsx`.

## 7. Trazabilidad

| Criterio | Requisito |
|----------|-----------|
| CA-06.1 | RF-06.2 |
| CA-06.2 | RF-06.3 |
| CA-06.3 | RF-06.4 |
| CA-06.4 | RF-06.5, RF-06.7 |
| CA-06.5 | RF-06.6 |
| CA-06.6 | RF-06.1 |
| CA-06.7 | RF-06.2, RF-06.6 |
| CA-06.8 | RF-06.2, RF-06.5 |
| CA-06.9 | (regresión) |
| CA-06.10 | RF-06.7 |
| CA-06.11 | RF-06.3, RNF-06.1 |
| (RNF) | RNF-06.1 → CA-06.4, CA-06.11; RNF-06.2 → CA-06.4 (texto de UI) |

## 8. Compuerta Fase 1 (ENTENDER)

- [ ] Decisión humana registrada de sacar HU-06 de la reserva (quién / fecha): _por registrar_.
- [ ] El humano valida la tabla de severidades §3.1 (art. XIII): _por registrar_.
- [ ] El humano acepta las ediciones a specs aprobadas (002 §6, 003 §5/R9) y steering listadas en tasks 14: _por registrar_.
- [ ] Decisiones propuestas por validar: insignia dentro de "Decisión" (sin columna nueva), contador = mostrados, detalle independiente del filtro, `severityForDecision` lanza ante códigos sin incidente: _por registrar_.
- [ ] El humano aprueba explícitamente este documento (aprobador / fecha): _por registrar_.
