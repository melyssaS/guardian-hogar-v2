# Requirements Document

**Spec:** `003-movement-simulation`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-03
**Estado:** Aprobado (2026-11-22) — refuerzo RC-01 pendiente de aprobación humana

> Trazabilidad: Necesidad → Peligro STPA → Requisito → Regla → Historia → Prueba → Evidencia.
> Este documento captura **qué** debe hacer el sistema, no **cómo**.

---

## Introduction

Esta spec cubre la HU-03 de Guardián Hogar: el operador elige un destino en el plano (por
clic o escribiendo coordenadas) y solicita el movimiento del robot; el sistema responde con
la **decisión del vigilante** y el **estado del robot**. El vigilante es independiente del
frontend (constitución art. III): **la interfaz nunca evalúa reglas**, solo muestra la
respuesta de la API. La decisión de colisión reutiliza el modelo geométrico y la función
`isCollision` de la spec `001-restricted-zones` y el vigilante de la spec de reglas; esta
spec añade el flujo de simulación de movimiento y su representación en la interfaz.

Alcance de la máquina de estados aquí: **IDLE, MOVING, SAFE_STOP**. Los estados DEGRADED y
RECOVERING existen en la constitución pero quedan fuera de esta spec (dependen de inyección
de fallos de sensor, reservada).

> **[RC-01] Refuerzo de convergencia con el prototipo.** Tras comparar las 5 HU del prototipo
> (`prototipo/Guardian_Hogar_Artifact_V2.html`) con la rama `integration`, esta spec se refuerza
> sin crear specs nuevas:
> - **Un solo vigilante.** La 003 deja de tener vigilante propio: la UI consume el vigilante de
>   la spec 002 por robot (`/api/robots/:robotId/*`). Se retiran `/api/simulation/*`,
>   `decideMovement` y el `reset` (DD-106); la parada se libera con `recover` validado. Cierra el
>   hallazgo B-1 del revisor (transición sin registro) y el art. III (dos caminos al estado).
> - **Catálogo de robots** (HU-01 del prototipo): registrar y consultar robots simulados.
> - **Sesión y secuencia** (HU-03 del prototipo): "Nueva sesión", secuencia por solicitud,
>   rechazo de duplicados y panel de telemetría.
> - **Vista de incidentes** (HU-05 del prototipo, parte UI) sobre el contrato de la 002.
> - **Supervisión multi-robot** y navegación como el prototipo.
>
> La máquina de estados completa (5 estados) y el vocabulario de decisiones son los de la
> spec 002; esta spec solo los **muestra**. Lo sustituido se conserva marcado
> "Sustituido por RC-01".

---

## 1. Historia de usuario

### HU-03 — Simulación de movimiento con decisión del vigilante
> Como **operador**, quiero **elegir un destino en el plano (clic o coordenadas) y solicitar
> el movimiento**, para **ver la decisión del vigilante y el estado del robot**.

### [RC-01] Historias del prototipo cubiertas por el refuerzo
| HU del prototipo | Qué aporta esta spec | Requisito |
|------------------|----------------------|-----------|
| HU-01 Registrar y consultar robots | Catálogo `robots`, `GET/POST /api/robots`, vista "Robots simulados" | R7 |
| HU-03 Simular movimiento y telemetría | Movimiento por destino (R1) + sesión, secuencia, duplicados y panel de telemetría | R1, R8 |
| HU-04 Evaluar regla y emitir STOP | Solo la UI: muestra la decisión del vigilante de la 002 y libera la parada con `recover` | R4, R11 |
| HU-05 Registrar y consultar incidentes | Solo la UI: vista "Incidentes" sobre `GET /api/incidents` de la 002 | R9 |
| (todas) | Supervisión multi-robot, indicadores y navegación del prototipo | R10 |

---

## 2. Conceptos y modelo de estado

### 2.1 Estado del robot (subconjunto en alcance)
| Estado | Significado |
|--------|-------------|
| `IDLE` | Robot detenido en una posición válida, listo para recibir un destino. |
| `MOVING` | El movimiento fue permitido; el robot queda en la nueva posición (destino). |
| `SAFE_STOP` | Parada preventiva activa; el robot permanece en su posición y no acepta nuevos movimientos hasta ser liberado. |

> Fallo seguro por defecto (constitución art. III): ante colisión o información
> insuficiente, el robot **no se mueve** y pasa/permanece en `SAFE_STOP`.

### 2.2 Decisión del vigilante
> **Sustituido por RC-01.** El vocabulario de la UI pasa a ser el de la spec 002:
> `AUTHORIZED` (200), `DENIED` (200, con `code`, `collisionType?`, `incidentId`) y `REJECTED`
> (409, `SAFE_STOP_ACTIVE`/`BUSY`). Equivalencias: `ALLOW` → `AUTHORIZED`,
> `PREVENTIVE_STOP` → `DENIED`, `DENIED_SAFE_STOP` → `REJECTED` + `SAFE_STOP_ACTIVE`.
> Tabla original (histórico):

El vigilante evalúa la solicitud y devuelve una **decisión**:
| Decisión | Significado |
|----------|-------------|
| `ALLOW` | Destino y trayectoria libres; el robot se mueve al destino. |
| `PREVENTIVE_STOP` | Destino en zona o trayectoria que la cruza; el robot no se mueve (parada preventiva). |
| `DENIED_SAFE_STOP` | La solicitud se rechaza porque el robot ya está en `SAFE_STOP` (`SAFE_STOP_ACTIVE`). |

### 2.3 Transiciones (en alcance)
> **Sustituido por RC-01.** La máquina de estados (IDLE, MOVING, SAFE_STOP, DEGRADED,
> RECOVERING), sus transiciones y su registro (`state_transition_log`) pertenecen a la spec 002.
> La UI de esta spec muestra los 5 estados tal como los devuelve la API. Diagrama original
> (histórico):

```
IDLE --(ALLOW)--------------> MOVING   (robot en nueva posición; vuelve a IDLE tras completar)
IDLE --(PREVENTIVE_STOP)----> SAFE_STOP (robot permanece en su posición)
SAFE_STOP --(move)----------> SAFE_STOP (rechazo DENIED_SAFE_STOP / SAFE_STOP_ACTIVE)
```
Toda transición se registra con su causa (constitución art. IV).

---

## Requirements

### Requirement 1: Selección de destino (RF-01)
**User Story:** Como operador, quiero fijar el destino del robot por clic en el plano o
escribiendo coordenadas, para solicitar un movimiento de forma precisa.

#### Acceptance Criteria
1. WHEN el operador hace clic sobre el plano THEN el sistema SHALL tomar ese punto como destino de la solicitud.
2. WHEN el operador escribe coordenadas `(x, y)` THEN el sistema SHALL tomar ese punto como destino de la solicitud.
3. WHEN el destino se fija por clic o por coordenadas THEN el sistema SHALL producir la misma solicitud de movimiento en ambos casos.
4. WHEN el destino cumple `0 <= x <= FLOOR_WIDTH` y `0 <= y <= FLOOR_HEIGHT` THEN el sistema SHALL aceptarlo como dentro del plano (los valores en el borde son inclusivos, es decir válidos).
5. IF el destino está estrictamente fuera del plano (`x < 0`, `x > FLOOR_WIDTH`, `y < 0` o `y > FLOOR_HEIGHT`) THEN el sistema SHALL impedir el envío en la UI y el backend SHALL responder `422 DESTINATION_OUT_OF_BOUNDS`.

### Requirement 2: Evaluación de la solicitud por el vigilante (RF-02)
**User Story:** Como operador, quiero que el backend decida si el movimiento es seguro, para
que la decisión no dependa de la interfaz.

> **[RC-01]** RF-02.1 y RF-02.2 quedan **sustituidos por RC-01**: los cumple el vigilante de la
> spec 002 (R1–R3 de la 002) a través de `POST /api/robots/:robotId/move`. RF-02.3 (la UI no
> replica reglas) **se mantiene** y aplica a todas las vistas nuevas.

#### Acceptance Criteria
1. WHEN se solicita un movimiento THEN el sistema SHALL evaluar el segmento desde la posición actual del robot (origen) hasta el destino.
2. WHEN el backend evalúa la solicitud THEN el sistema SHALL devolver la decisión del vigilante y el estado resultante del robot.
3. WHEN la UI necesita una decisión THEN el sistema SHALL realizar la evaluación solo en el backend y la UI NO SHALL replicar la lógica de reglas.

### Requirement 3: Resultado del movimiento (RF-03)
**User Story:** Como operador, quiero ver el resultado del movimiento (permitido, parada
preventiva o denegado), para conocer el estado del robot.

> **Sustituido por RC-01.** El resultado lo decide el vigilante de la spec 002: RF-03.1 →
> `AUTHORIZED` (respuesta `MOVING`, estado persistido `IDLE`); RF-03.2 → `DENIED` con `code`,
> `collisionType` e `incidentId`, robot en `SAFE_STOP`; RF-03.3 → `409 REJECTED`
> `SAFE_STOP_ACTIVE` sin cambios. Los criterios de abajo quedan como histórico; la verificación
> vigente está en los CA de la §6.1.

#### Acceptance Criteria
1. WHEN el destino y la trayectoria están libres y el robot no está en SAFE_STOP THEN el sistema SHALL responder `ALLOW`, mover el robot a la nueva posición y devolver estado `MOVING` y luego `IDLE`.
2. WHEN el destino está dentro de una zona o la trayectoria la cruza THEN el sistema SHALL responder `PREVENTIVE_STOP`, mantener el robot en su posición de origen, devolver estado `SAFE_STOP` e indicar la causa (tipo de colisión).
3. IF el robot está en `SAFE_STOP` WHEN se solicita cualquier movimiento THEN el sistema SHALL responder `DENIED_SAFE_STOP` con `SAFE_STOP_ACTIVE` y NO SHALL cambiar la posición ni el estado del robot.

### Requirement 4: Representación en la interfaz (RF-04)
**User Story:** Como operador, quiero que la interfaz muestre la respuesta de la API, para
ver la decisión y el estado sin que la UI recalcule reglas.

#### Acceptance Criteria
1. WHEN la UI recibe la respuesta de la API THEN el sistema SHALL mostrar la decisión, el estado y la posición sin evaluar reglas en el cliente.
2. WHEN la decisión es `PREVENTIVE_STOP` THEN la UI SHALL mostrar una indicación de parada preventiva y su causa. **[RC-01] Sustituido:** WHEN la decisión es `DENIED` THEN la UI SHALL mostrar la parada preventiva con su `code`, la zona implicada (si la hay) y el `incidentId`.
3. WHEN la decisión es `DENIED_SAFE_STOP` THEN la UI SHALL mostrar la denegación `SAFE_STOP_ACTIVE`. **[RC-01] Sustituido:** WHEN la API responde `409 REJECTED` THEN la UI SHALL mostrar el rechazo con su `code` (`SAFE_STOP_ACTIVE` o `BUSY`) tal como llega, sin inventar un código por defecto.
4. WHEN se completa una solicitud THEN la UI SHALL reflejar la posición y el estado actuales del robot.
5. WHILE una solicitud está en curso THEN la UI SHALL manejar los estados de carga y error.
6. **[RC-01]** WHEN la API devuelve un estado o una calidad de posición (`IDLE`, `MOVING`, `SAFE_STOP`, `DEGRADED`, `RECOVERING`; `RELIABLE`, `UNRELIABLE`, `MISSING`) THEN la UI SHALL mostrarlos tal cual, con el color del prototipo, sin deducirlos.

### Requirement 5: Registro de la decisión (RF-05)
**User Story:** Como equipo de QA/seguridad, quiero que cada decisión de movimiento se
registre con su causa, para mantener la trazabilidad.

> **Sustituido por RC-01.** El registro lo hace el vigilante de la spec 002: incidentes
> (`incidents`), rechazos y duplicados (`audit_log`) y transiciones (`state_transition_log`),
> todos append-only. `movement_log` (de esta spec) se **conserva como histórico inmutable** y deja
> de recibir filas al retirarse el vigilante provisional.

#### Acceptance Criteria
1. WHEN se procesa una evaluación de movimiento THEN el sistema SHALL registrar la decisión, el tipo de colisión (si aplica), el origen, el destino y el estado resultante.
2. WHEN se registra una decisión THEN el registro SHALL ser inmutable (solo inserción, sin actualización ni borrado).

### Requirement 6: Calidad de contrato y determinismo (RNF)
**User Story:** Como desarrollador, quiero un contrato validado y decisiones deterministas,
para garantizar robustez y reproducibilidad.

#### Acceptance Criteria
1. WHEN se recibe una solicitud THEN el sistema SHALL validar la entrada con Zod antes de procesarla y SHALL rechazar un payload inválido con `422 INVALID_DESTINATION`. **[RC-01]** El payload de `move` incluye `sessionId` y `sequence` (R8); el de `POST /api/robots`, `name` y `type` (R7, `422 INVALID_ROBOT`).
2. WHEN ocurre un error THEN el sistema SHALL responder con formato `{ code, message }` y NO SHALL exponer trazas de pila.
3. WHEN se evalúan dos solicitudes que comparten el mismo origen, el mismo destino, las mismas zonas activas y el mismo estado del robot THEN el sistema SHALL producir en ambas la misma decisión (el determinismo se exige solo bajo esas condiciones iguales, no como propiedad global incondicional).

---

### Requirement 7 [RC-01]: Catálogo de robots simulados (RF-07; HU-01 del prototipo)
**User Story:** Como operador, quiero registrar y consultar robots simulados, para saber
cuáles participan en las pruebas de seguridad.

#### Acceptance Criteria
1. WHEN el operador registra un robot con `name` y `type` THEN el sistema SHALL crearlo y responder `201` con el robot y su estado inicial.
2. IF `name`, tras quitar espacios, está vacío o supera 60 caracteres, o `type` no es `VACUUM` ni `GUARD` THEN el sistema SHALL responder `422 INVALID_ROBOT` y NO SHALL crear el robot.
3. IF ya existe un robot con el mismo `name` THEN el sistema SHALL responder `409 ROBOT_NAME_DUPLICATE`.
4. WHEN se crea un robot THEN el backend SHALL asignar el estado inicial (`IDLE`, `positionQuality = RELIABLE`, posición (120, 90)); el cliente NO SHALL poder enviar estado ni posición.
5. WHEN el operador recarga la aplicación THEN los robots registrados SHALL seguir disponibles (persistencia en SQLite).
6. WHEN la base es nueva THEN el sistema SHALL sembrar los robots del prototipo: `Aspiradora A1` (`VACUUM`, (160, 123)) y `Vigilante V2` (`GUARD`, (488, 290)).
7. WHEN se consulta un robot inexistente THEN el sistema SHALL responder `404 ROBOT_NOT_FOUND`.
8. WHEN el operador abre la vista "Robots simulados" THEN la UI SHALL mostrar una tarjeta por robot (nombre, tipo, estado, calidad de posición, posición) y un botón "＋ Registrar robot" que abre un modal con nombre y tipo, como el prototipo.

### Requirement 8 [RC-01]: Sesión y secuencia de solicitudes (RF-08; HU-03 del prototipo)
**User Story:** Como operador, quiero controlar el movimiento por sesiones y que cada
solicitud identifique robot, sesión y secuencia, para que los duplicados no produzcan
decisiones repetidas.

#### Acceptance Criteria
1. WHEN el operador pulsa "↻ Nueva sesión" THEN el sistema SHALL crear una sesión para el robot (`POST /api/robots/:robotId/sessions` → `201 { sessionId }`) e invalidar la anterior de ese robot.
2. WHEN se solicita un movimiento THEN la solicitud SHALL incluir `sessionId` y `sequence` (entero ≥ 1) y el robot SHALL identificarse por la ruta.
3. IF `sessionId` es desconocido o no es la sesión vigente del robot THEN el sistema SHALL responder `409 INVALID_SESSION` sin evaluar ni cambiar el estado.
4. IF `sequence` es menor o igual que la última aceptada en esa sesión THEN el sistema SHALL responder `409 DUPLICATE_EVENT`, NO SHALL evaluar ni cambiar el estado, NO SHALL crear incidente y SHALL auditar el rechazo.
5. WHEN una solicitud se acepta THEN el sistema SHALL persistir por robot la última solicitud aceptada (sesión, secuencia, destino y fecha).
6. WHEN la UI envía solicitudes THEN SHALL incrementar `sequence` por sesión de forma automática; el operador no la escribe.
7. WHEN se completa una solicitud THEN la UI SHALL mostrar en el panel "Telemetría" el JSON de la última solicitud enviada y de la respuesta recibida, sin transformarlo.

### Requirement 9 [RC-01]: Vista de incidentes (RF-09; HU-05 del prototipo, parte UI)
**User Story:** Como operador, quiero consultar los incidentes con su origen y decisión, para
revisar el comportamiento del Guardián.

#### Acceptance Criteria
1. WHEN el operador abre la vista "Incidentes" THEN la UI SHALL listar los incidentes de `GET /api/incidents` del más reciente al más antiguo, en una tabla Fecha · Robot · Regla · Zona · Decisión, con el contador "N eventos".
2. WHEN el operador selecciona un incidente THEN la UI SHALL mostrar su detalle (`GET /api/incidents/:id`): regla, código de decisión, tipo de colisión, origen, destino, estado resultante, motivo y snapshot de zonas.
3. WHEN no hay incidentes THEN la UI SHALL mostrar un estado vacío explícito.
4. WHEN se muestran los botones "Filtrar por severidad · HU-06" y "Exportar CSV · HU-07" THEN SHALL estar deshabilitados (HU reservadas), como en el prototipo.
5. WHEN la UI muestra un incidente THEN NO SHALL modificarlo ni recalcularlo: es de solo lectura.

### Requirement 10 [RC-01]: Supervisión multi-robot y navegación (RF-10)
**User Story:** Como operador, quiero supervisar todos los robots en el plano y navegar entre
las vistas del prototipo, para provocar escenarios y ver la decisión del Guardián.

#### Acceptance Criteria
1. WHEN el operador abre la aplicación THEN la barra lateral SHALL ofrecer: Supervisión, Robots simulados, Zonas y reglas e Incidentes.
2. WHEN el operador abre "Supervisión" THEN el plano SHALL mostrar todos los robots con su posición y su color por estado (activo azul `#3176d2`, vigilante morado `#665dd3`, `SAFE_STOP` rojo `#bd4954`, `DEGRADED` gris `#8893a2`) y un selector de robot; el clic y las coordenadas aplican al robot seleccionado.
3. WHEN la vista "Supervisión" está abierta THEN SHALL mostrar los indicadores: robots activos, decisiones de parada (`DENIED`), solicitudes procesadas y zonas restringidas, calculados a partir de datos de la API.
4. WHEN el operador pulsa "⚠ Enviar a escaleras" THEN la UI SHALL fijar como destino del robot seleccionado un punto dentro de la zona "Escaleras" y solicitar el movimiento; IF "Escaleras" no está activa THEN SHALL avisar como el prototipo, sin decidir nada por su cuenta.
5. WHEN el operador pulsa "Liberar parada" THEN la UI SHALL llamar a `recover` del robot seleccionado (R11).

### Requirement 11 [RC-01]: Un solo vigilante; liberar la parada con `recover` (RF-11)
**User Story:** Como responsable de seguridad, quiero que la UI use un único vigilante, para
que ningún camino mueva el robot o lo saque de la parada sin validación ni registro.

#### Acceptance Criteria
1. WHEN la UI solicita estado, movimiento o recuperación THEN SHALL usar solo `/api/robots/:robotId/state|move|recover` (spec 002); `/api/simulation/*` SHALL responder `404`.
2. WHEN el operador libera la parada THEN la UI SHALL llamar a `POST /api/robots/:robotId/recover`; IF la respuesta es `409 RECOVERY_NOT_ALLOWED` THEN SHALL mostrar su `cause` (`UNRELIABLE_DATA`, `ZONE_DATA_UNAVAILABLE` o `UNSAFE_POSITION`) y el robot SHALL seguir en parada.
3. WHEN `recover` responde `200` THEN la UI SHALL mostrar "Parada liberada" solo si `transitioned` es `true`, y "El robot ya estaba en IDLE" si es `false`.
4. WHEN se retira el `reset` THEN NO SHALL existir en la UI ni en la API ningún control que lleve el robot a `IDLE` sin pasar por `recover`.

## 4. Requisitos no funcionales

- RNF-01 Validación de todas las entradas con **Zod** antes de procesar.
- RNF-02 Sin `any` en TypeScript; contratos compartidos vía `@home-guardian/domain`.
- RNF-03 La lógica de decisión es del backend; reutiliza geometría **pura** de la spec 001.
- RNF-04 Nunca exponer stack traces; errores con `code` estable y HTTP correcto.
- RNF-05 Respuestas de error con formato uniforme `{ code, message }`.
- RNF-06 Determinismo: la misma solicitud (mismo origen, destino, zonas y estado) produce la
  misma decisión.

---

## 5. Contrato de API

> **Sustituido por RC-01.** `/api/simulation/*` se retira. El contrato vigente es:
>
> | Método | Ruta | Propietaria | Descripción |
> |--------|------|-------------|-------------|
> | `GET` | `/api/robots` | 003 | Lista de robots con su estado actual |
> | `POST` | `/api/robots` | 003 | Registrar robot `{ name, type }` → `201` |
> | `GET` | `/api/robots/:robotId` | 003 | Un robot con su estado actual |
> | `POST` | `/api/robots/:robotId/sessions` | 003 | Nueva sesión → `201 { sessionId }` |
> | `GET` | `/api/robots/:robotId/state` | 002 | Estado, posición y `positionQuality` |
> | `POST` | `/api/robots/:robotId/move` | 002 (+ validación de sesión de la 003) | `{ destination, sessionId, sequence }` |
> | `POST` | `/api/robots/:robotId/recover` | 002 | Recuperación validada (`transitioned`) |
> | `POST` | `/api/robots/:robotId/position` | 002 | Lectura de posición (sin UI en esta spec) |
> | `GET` | `/api/incidents?robotId=` | 002 | Incidentes, del más reciente al más antiguo |
> | `GET` | `/api/incidents/:id` | 002 | Detalle con `zonesSnapshot` |
>
> Entidad `Robot` (lectura):
> ```json
> {
>   "id": 1, "name": "Aspiradora A1", "type": "VACUUM", "createdAt": "2026-11-22T00:00:00.000Z",
>   "state": "IDLE", "position": { "x": 160, "y": 123 }, "positionQuality": "RELIABLE"
> }
> ```
> `POST /api/robots/:robotId/move` (request):
> ```json
> { "destination": { "x": 250, "y": 175 }, "sessionId": "5f1c…", "sequence": 7 }
> ```
> Respuestas: las de la spec 002 (`AUTHORIZED`/`DENIED` 200, `REJECTED` 409), más `409
> INVALID_SESSION` y `409 DUPLICATE_EVENT` (R8). El contrato original se conserva abajo como
> histórico.

Base: `/api/simulation`

### Entidad `RobotState` (lectura)
```json
{
  "state": "IDLE",
  "position": { "x": 120.0, "y": 90.0 }
}
```

### Endpoints
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/simulation/robot` | Estado y posición actuales del robot |
| `POST` | `/api/simulation/move` | Solicitar movimiento a un destino |
| `POST` | `/api/simulation/reset` | Liberar `SAFE_STOP` y volver a `IDLE` (soporte de demo) |

#### `POST /api/simulation/move`
Request:
```json
{ "destination": { "x": 250.0, "y": 175.0 } }
```
> El **origen** es la posición actual del robot en el servidor; el cliente no lo envía.

Respuesta `ALLOW` (200):
```json
{
  "decision": "ALLOW",
  "state": "MOVING",
  "position": { "x": 250.0, "y": 175.0 },
  "reason": "Destination and trajectory are clear"
}
```

Respuesta `PREVENTIVE_STOP` (200):
```json
{
  "decision": "PREVENTIVE_STOP",
  "state": "SAFE_STOP",
  "position": { "x": 120.0, "y": 90.0 },
  "collisionType": "TRAJECTORY_CROSSES_ZONE",
  "zoneName": "Escaleras",
  "reason": "Trajectory crosses restricted zone: Escaleras"
}
```

Respuesta `DENIED_SAFE_STOP` (409):
```json
{
  "decision": "DENIED_SAFE_STOP",
  "code": "SAFE_STOP_ACTIVE",
  "state": "SAFE_STOP",
  "position": { "x": 120.0, "y": 90.0 },
  "reason": "Robot is in SAFE_STOP; movement denied"
}
```

#### `POST /api/simulation/reset`
- `200` → `{ "state": "IDLE", "position": { ... } }`

### Catálogo de errores
| HTTP | `code` | Causa |
|------|--------|-------|
| 409 | `SAFE_STOP_ACTIVE` | Movimiento solicitado estando en `SAFE_STOP` |
| 422 | `DESTINATION_OUT_OF_BOUNDS` | Destino fuera del plano |
| 422 | `INVALID_DESTINATION` | Payload de destino inválido (Zod) |
| 422 | `INVALID_ROBOT` | **[RC-01]** Nombre (1–60 tras `trim`) o tipo inválido al registrar un robot |
| 409 | `ROBOT_NAME_DUPLICATE` | **[RC-01]** Ya existe un robot con ese nombre |
| 404 | `ROBOT_NOT_FOUND` | **[RC-01]** El `robotId` no existe |
| 409 | `INVALID_SESSION` | **[RC-01]** `sessionId` desconocido o no vigente para el robot |
| 409 | `DUPLICATE_EVENT` | **[RC-01]** `sequence` duplicada o fuera de orden en la sesión |
| 409 | `RECOVERY_NOT_ALLOWED` | **[RC-01]** `recover` rechazado; incluye `cause` (spec 002) |

> **[RC-01]** `409 SAFE_STOP_ACTIVE` pasa a ser `409 REJECTED` con `code: SAFE_STOP_ACTIVE`
> (spec 002).

> `PREVENTIVE_STOP` no es un error de transporte: es una **decisión** válida del vigilante y
> responde `200` con la decisión en el cuerpo. `DENIED_SAFE_STOP` usa `409` porque la
> solicitud es inválida respecto al estado actual.

---

## 6. Criterios de aceptación (Given / When / Then)

- **CA-03.1** Dado el robot en `IDLE` y un destino libre, cuando el operador solicita el
  movimiento, entonces la API responde `ALLOW` y el robot aparece en la nueva posición.
- **CA-03.2** Dado un destino **dentro de una zona** restringida, cuando se solicita el
  movimiento, entonces la API responde `PREVENTIVE_STOP`, el robot permanece en su posición y
  la UI muestra la indicación de parada preventiva.
- **CA-03.3** Dado un destino libre pero cuya **trayectoria cruza** una zona, cuando se
  solicita el movimiento, entonces la API responde `PREVENTIVE_STOP` con
  `collisionType=TRAJECTORY_CROSSES_ZONE` y el robot no se mueve.
- **CA-03.4** Dado el robot en `SAFE_STOP`, cuando se solicita cualquier movimiento, entonces
  la API responde `409 SAFE_STOP_ACTIVE` (`DENIED_SAFE_STOP`) y la UI muestra la denegación.
- **CA-03.5** Dado un destino **fuera del plano**, cuando se solicita el movimiento, entonces
  la API responde `422 DESTINATION_OUT_OF_BOUNDS` y el robot no cambia.
- **CA-03.6** Dado que la decisión la toma el backend, cuando la UI recibe la respuesta,
  entonces **solo muestra** la decisión/estado/posición sin recalcular reglas.
- **CA-03.7** Dado el operador, cuando fija el destino por **clic** o por **coordenadas**,
  entonces ambos caminos producen la misma solicitud y el mismo resultado.
- **CA-03.8** Dada una evaluación de movimiento, cuando se procesa, entonces se **registra**
  con su causa (decisión, tipo de colisión si aplica, origen, destino, estado resultante).

---

### 6.1 [RC-01] Criterios vigentes tras el refuerzo
Los CA-03.1 a CA-03.8 de arriba quedan como histórico; los siguientes los **sustituyen** (mismo
número) o son **nuevos**.

- **CA-03.1 [RC-01] (sustituye)** Dado un robot en `IDLE` con una sesión vigente y un destino
  libre, cuando el operador solicita el movimiento, entonces `POST /api/robots/:robotId/move`
  responde `200 AUTHORIZED` (`state: MOVING`), el robot aparece en el destino y
  `GET /api/robots/:robotId/state` devuelve `IDLE`.
- **CA-03.2 [RC-01] (sustituye)** Dado un destino **dentro de una zona** restringida activa,
  cuando se solicita el movimiento, entonces la API responde `200 DENIED` con
  `code: RESTRICTED_ZONE_VIOLATION` e `incidentId`, el robot permanece en su posición en
  `SAFE_STOP` y la UI muestra la parada preventiva con la zona y el incidente.
- **CA-03.3 [RC-01] (sustituye)** Dado un destino libre cuya **trayectoria cruza** una zona
  activa, cuando se solicita el movimiento, entonces la API responde `200 DENIED` con
  `code: TRAJECTORY_CROSSES_ZONE` y el robot no se mueve.
- **CA-03.4 [RC-01] (sustituye)** Dado un robot en `SAFE_STOP`, cuando se solicita cualquier
  movimiento, entonces la API responde `409 REJECTED` con `code: SAFE_STOP_ACTIVE`, no se crea
  incidente y la UI muestra el rechazo con el código recibido.
- **CA-03.5 [RC-01] (sustituye)** Dado un destino **fuera del plano**, cuando se solicita el
  movimiento, entonces `POST /api/robots/:robotId/move` responde
  `422 DESTINATION_OUT_OF_BOUNDS`, el robot no cambia y la UI ya había impedido el envío.
- **CA-03.6 [RC-01] (se mantiene, ampliado)** Dado que la decisión la toma el backend, cuando la
  UI recibe cualquier respuesta (movimiento, recuperación, incidentes), entonces **solo muestra**
  lo recibido, sin recalcular reglas ni deducir estados.
- **CA-03.7 [RC-01] (sustituye)** Dado el robot seleccionado, cuando el operador fija el destino
  por **clic** o por **coordenadas**, entonces ambos caminos producen el mismo cuerpo
  `{ destination, sessionId, sequence }` contra `/api/robots/:robotId/move`.
- **CA-03.8 [RC-01] (sustituye)** Dada una evaluación de movimiento, cuando se procesa, entonces
  queda registrada por el vigilante de la spec 002 (incidente si para, `audit_log` si es un
  rechazo, `state_transition_log` si cambia el estado); `movement_log` no recibe filas nuevas.
- **CA-03.9 [RC-01] (nuevo)** Dado el operador en "Robots simulados", cuando registra un robot
  con nombre válido y tipo, entonces la API responde `201`, el robot aparece en la lista y en el
  plano de "Supervisión" en (120, 90) con estado `IDLE`.
- **CA-03.10 [RC-01] (nuevo)** Dado un nombre vacío, solo espacios, de más de 60 caracteres o
  repetido, cuando el operador lo registra, entonces la API responde `422 INVALID_ROBOT` o
  `409 ROBOT_NAME_DUPLICATE` y la UI muestra el error sin crear el robot.
- **CA-03.11 [RC-01] (nuevo)** Dada una sesión vigente, cuando se reenvía una solicitud con una
  `sequence` ya aceptada (o menor), entonces la API responde `409 DUPLICATE_EVENT`, el estado no
  cambia, no se crea incidente y el rechazo queda auditado.
- **CA-03.12 [RC-01] (nuevo)** Dado un robot, cuando el operador pulsa "Nueva sesión",
  entonces la sesión anterior deja de ser válida (`409 INVALID_SESSION` si se usa) y la nueva
  acepta `sequence = 1`.
- **CA-03.13 [RC-01] (nuevo)** Dado un robot en `SAFE_STOP` en posición segura, cuando el
  operador pulsa "Liberar parada", entonces `recover` responde `200` con `transitioned: true`,
  la UI muestra "Parada liberada" y el robot queda en `IDLE`.
- **CA-03.14 [RC-01] (nuevo)** Dado un robot en parada dentro de una zona activa, cuando el
  operador pulsa "Liberar parada", entonces la API responde `409 RECOVERY_NOT_ALLOWED` con
  `cause: UNSAFE_POSITION`, la UI muestra la causa y el robot sigue en parada.
- **CA-03.15 [RC-01] (nuevo)** Dado que se produjo una denegación, cuando el operador abre
  "Incidentes", entonces ve el incidente (fecha, robot, regla `R-ZONA-01`, zona, decisión) y al
  seleccionarlo ve su detalle con el snapshot de zonas.
- **CA-03.16 [RC-01] (nuevo)** Dado el plano de "Supervisión", cuando hay varios robots,
  entonces todos se dibujan con el color de su estado y el selector determina a cuál se aplican
  el clic, las coordenadas, "Enviar a escaleras" y "Liberar parada".
- **CA-03.17 [RC-01] (nuevo)** Dado cualquier momento, cuando se llama a `/api/simulation/*`,
  entonces la API responde `404` (un solo vigilante).

## Glossary

| Término | Definición |
|---------|------------|
| Vigilante | Componente del backend que decide si un movimiento es seguro; independiente de la UI. |
| Decisión | Resultado del vigilante: `ALLOW`, `PREVENTIVE_STOP` o `DENIED_SAFE_STOP`. |
| Parada preventiva | Negativa a moverse porque el destino o la trayectoria cruzan una zona. |
| SAFE_STOP | Estado de parada segura; no acepta nuevos movimientos hasta ser liberado. |
| `SAFE_STOP_ACTIVE` | Código de denegación cuando se pide movimiento estando en SAFE_STOP. |
| Origen / Destino | Posición actual del robot / punto objetivo elegido por el operador. |
| Trayectoria | Segmento recto origen → destino evaluado contra las zonas. |
| Robot simulado **[RC-01]** | Unidad del catálogo (`VACUUM` aspiradora o `GUARD` vigilante) con estado propio en el backend. |
| Sesión **[RC-01]** | Periodo de control de un robot identificado por `sessionId`; "Nueva sesión" la reinicia. |
| Secuencia **[RC-01]** | Número creciente por sesión que identifica cada solicitud; evita duplicados. |
| Incidente **[RC-01]** | Registro inmutable de una denegación que para el robot (spec 002), con regla y zona. |
| Regla **[RC-01]** | Entrada del catálogo `RULES` (spec 001): `R-ZONA-01`, `R-SIGNAL-01`, `R-DATA-01`. |

---

## 7. Fuera de alcance (reservado)

> **[RC-01]** Siguen fuera de alcance, además de lo de abajo: colisiones entre robots (los
> robots no se bloquean entre sí; limitación conocida), filtrar y exportar incidentes (HU-06 y
> HU-07, botones deshabilitados) y el botón "Perder conexión" mientras no se resuelva la
> pregunta Q-B. Los estados `DEGRADED` y `RECOVERING` dejan de estar "fuera": la UI los
> **muestra** cuando la API los devuelve, aunque no los provoque.

- **Inyección de fallos de sensor** (reservada para demo en vivo).
- **Alerta A-04** (reservada).
- **Prueba T-18** (reservada).
- Estados `DEGRADED` y `RECOVERING` de la máquina de estados (dependen de los sensores).
- Trayectorias curvas y movimiento con pasos intermedios/animación física.
- Autenticación y autorización.

---

## 8. Dependencias

> **[RC-01]**
> - **spec 002**: vigilante por robot (`/api/robots/:robotId/state|move|recover|position`),
>   `robot_state` con una fila por robot, incidentes con `robot_id` y `rule`, `audit_log`,
>   `state_transition_log` y la validación de sesión/secuencia dentro del flujo de `move`.
> - **spec 001**: catálogo `RULES` (constante de dominio) que se muestra en incidentes.

- **spec `001-restricted-zones`**: modelo geométrico, `Zone`, `isCollision`, `CollisionType`.
- **spec del vigilante (reglas)**: mapeo de tipo de colisión a decisión/razón.
- El estado y la posición del robot se mantienen en el backend (fuente de verdad).

---

## 9. Trazabilidad

```
HU-03
  → requirements.md (este documento)
    → design.md
      → tasks.md
        → código (backend/simulation + rules, frontend/SimulationPage)
          → pruebas (unit decisión, integración /api/simulation, e2e clic→decisión)
            → evidencia (CI verde + demo)
```

---

## 10. Compuerta Fase 1 (ENTENDER)

- [x] El humano aprueba explícitamente este `requirements.md` antes de pasar a DISEÑAR. (2026-11-22)

---

## 11. Preguntas abiertas [RC-01]

- **Q-A.** Autenticación del operador: la piden HU-02 y HU-05 del prototipo y el stack de
  CLAUDE.md (bcrypt + JWT en cookie HttpOnly). ¿Requisito transversal ahora (en la 001) o deuda
  documentada? Esta spec no la implementa mientras no se decida.
- **Q-B.** Botón "Perder conexión" (HU-04 del prototipo) frente a la reserva de inyección de
  fallos de esta spec (§7). ¿Se habilita (enviando `POST /api/robots/:robotId/position` con
  `quality: MISSING`) o queda reservado?
- **Q-C.** Aprobación formal de las specs 001 y 002, implementadas pero aún en "Borrador"
  (art. XII). El refuerzo RC-01 de esta spec depende de los contratos de ambas.

## 12. Registro de cambios

| Fecha | Cambio | Resumen |
|-------|--------|---------|
| 2026-11-22 | Aprobación | requirements.md aprobado por el humano (compuerta Fase 1). |
| 2026-11-22 | **RC-01** (pendiente de aprobación) | Convergencia con el prototipo: un solo vigilante (retirada de `/api/simulation/*`, `decideMovement` y `reset`; `recover` validado), catálogo de robots (R7), sesión y secuencia (R8), vista de incidentes (R9), supervisión multi-robot y navegación (R10), un solo vigilante en la UI (R11). CA-03.1–03.5, 03.7 y 03.8 sustituidos; CA-03.6 ampliado; CA-03.9–03.17 nuevos. RF-02.1/02.2, RF-03 y RF-05 sustituidos por la spec 002. |
