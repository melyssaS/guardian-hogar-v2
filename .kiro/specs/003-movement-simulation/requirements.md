# Requirements Document

**Spec:** `003-movement-simulation`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-03
**Estado:** Aprobado (2026-11-22); revisión QA RECHAZADA por B-1 — se resuelve con RC-01; refuerzo RC-01 pendiente de aprobación (incluidas rev2 a rev6)

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
de fallos de sensor, reservada). *(Sustituido por RC-01 rev3 (N-10): la UI **muestra** los 5
estados que devuelve la API (R4.6) y la pérdida de señal está en alcance (R10.6, R10.7); solo la
inyección de fallos de sensor sigue reservada.)*

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
>
> **[RC-01 rev2]** Tras la revisión del analista (veredicto REQUIERE CAMBIOS) y las decisiones del
> humano del 2026-11-23: la UI migra **una sola vez**, directamente a `/api/robots/:robotId/*`;
> los rechazos (`INVALID_SESSION`, `DUPLICATE_EVENT`, `ROBOT_START_IN_RESTRICTED_ZONE`) se
> auditan siempre; un robot no puede darse de alta dentro de una zona activa; la UI ofrece
> "⌁ Perder conexión" y "↻ Recuperar señal"; y la autenticación queda como riesgo aceptado
> (§11b). Detalle en el registro de cambios (§12).

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
> `AUTHORIZED` (~~respuesta `MOVING`, estado persistido `IDLE`~~ **[RC-01 rev4] (I-7)** respuesta
> `state: IDLE`, que es lo implementado, DD-133); RF-03.2 → `DENIED` con `code`,
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
1. WHEN se recibe una solicitud THEN el sistema SHALL validar la entrada con Zod antes de procesarla y SHALL rechazar un payload inválido con `422 INVALID_DESTINATION`. **[RC-01]** El payload de `move` incluye `sessionId` y `sequence` (R8); el de `POST /api/robots`, `name` y `type` (R7, `422 INVALID_ROBOT`). **[RC-01 rev2]** Un payload de `POST /api/robots/:robotId/move` inválido responde `422 INVALID_MOVE_REQUEST` (sustituye a `INVALID_DESTINATION` en el endpoint nuevo); el destino fuera del plano sigue siendo `422 DESTINATION_OUT_OF_BOUNDS`.
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
4. WHEN se crea un robot THEN el backend SHALL asignar el estado inicial (`IDLE`, `positionQuality = RELIABLE`, posición (120, 90)); el cliente NO SHALL poder enviar estado ni posición. **[RC-01 rev2]** El estado inicial lo crea `guardianService.initRobot` (spec 002) en la misma transacción que la fila de `robots`.
5. WHEN el operador recarga la aplicación THEN los robots registrados SHALL seguir disponibles (persistencia en SQLite).
6. ~~WHEN la base es nueva THEN el sistema SHALL sembrar los robots del prototipo: `Aspiradora A1` (`VACUUM`, (160, 123)) y `Vigilante V2` (`GUARD`, (488, 290)). **[RC-01 rev2]** WHEN la base ya existe THEN `Aspiradora A1` SHALL conservar la posición, el estado y la calidad de la fila actual de `robot_state`, sin `UPDATE` encubiertos (Q-E).~~ *(Sustituido por RC-01 rev3, Q-I.)* **[RC-01 rev3]** WHEN se aplican las migraciones THEN SHALL existir `Aspiradora A1` (`VACUUM`) con la posición, el estado y la calidad de la fila actual de `robot_state` (`id = 1`), que la `008` de la spec 002 asocia a A1 tal cual —en una base nueva, (120, 90), `IDLE`, `RELIABLE`— y `Vigilante V2` (`GUARD`) en (488, 290), `IDLE`, `RELIABLE`. Sin lógica de detección de "base nueva" ni `UPDATE` encubiertos (Q-I).
7. WHEN se consulta un robot inexistente THEN el sistema SHALL responder `404 ROBOT_NOT_FOUND`.
8. WHEN el operador abre la vista "Robots simulados" THEN la UI SHALL mostrar una tarjeta por robot (nombre, tipo, estado, calidad de posición, posición) y un botón "＋ Registrar robot" que abre un modal con nombre y tipo, como el prototipo.
9. **[RC-01 rev2]** IF la posición inicial (120, 90) cae dentro de una zona **activa** expandida por r + m THEN el sistema SHALL responder `409 ROBOT_START_IN_RESTRICTED_ZONE`, NO SHALL crear el robot ni su estado y SHALL auditar el rechazo en `audit_log` (Q-D). **[RC-01 rev3] (N-2)** La comprobación es una decisión de seguridad y la toma el vigilante: el catálogo invoca `guardianService.checkStartPosition(position)` (spec 002, regla pura `evaluateStartPosition`) **antes** de insertar en `robots`; la 002 audita el rechazo. Después, en la misma transacción, el catálogo inserta en `robots` y llama a `guardianService.initRobot(robotId, position)`, que solo crea el estado y registra la transición inicial. **[RC-01 rev4] (decisión humana 1, art. XIII)** IF las zonas no se pueden leer al validar la posición inicial THEN el sistema SHALL responder `409 ROBOT_START_NOT_VERIFIABLE` con `cause: "ZONE_DATA_UNAVAILABLE"` (cuerpo `{ code, message, cause }`), NO SHALL crear el robot ni su estado y SHALL auditar el rechazo con la misma `cause` en `detail`. `ROBOT_START_IN_RESTRICTED_ZONE` queda solo para "posición dentro de una zona activa" (Q-D).
10. **[RC-01 rev4] (M-10)** WHEN se registra un robot THEN el sistema SHALL validar en este orden y detenerse en el primer fallo: 1) payload → `422 INVALID_ROBOT`; 2) nombre duplicado → `409 ROBOT_NAME_DUPLICATE`; 3) posición de inicio con `guardianService.checkStartPosition` → `409 ROBOT_START_IN_RESTRICTED_ZONE` o `409 ROBOT_START_NOT_VERIFIABLE`. Solo el paso 3 SHALL auditarse (lo audita la spec 002).
11. **[RC-01 rev4] (decisión humana 4) Limitación aceptada:** A1 y todo robot registrado empiezan en (120, 90), así que en el plano sus marcadores pueden quedar **superpuestos**. Se distinguen por su etiqueta y por el selector de robot; no se añade lógica para separarlos.

### Requirement 8 [RC-01]: Sesión y secuencia de solicitudes (RF-08; HU-03 del prototipo)
**User Story:** Como operador, quiero controlar el movimiento por sesiones y que cada
solicitud identifique robot, sesión y secuencia, para que los duplicados no produzcan
decisiones repetidas.

#### Acceptance Criteria
1. WHEN el operador pulsa "↻ Nueva sesión" THEN el sistema SHALL crear una sesión para el robot (`POST /api/robots/:robotId/sessions` → `201 { sessionId }`, `sessionService.startSession`) e invalidar la anterior de ese robot. **[RC-01 rev3] (N-13)** El inicio de sesión SHALL auditarse en `audit_log` con `event_code = 'SESSION_STARTED'` (exigido por la spec 002, R11.1).
2. WHEN se solicita un movimiento THEN la solicitud SHALL incluir `sessionId` y `sequence` (entero ≥ 1) y el robot SHALL identificarse por la ruta.
3. IF `sessionId` es desconocido o no es la sesión vigente del robot THEN el sistema SHALL responder `409 INVALID_SESSION` sin evaluar ni cambiar el estado.
4. IF `sequence` es menor o igual que la última aceptada en esa sesión THEN el sistema SHALL responder `409 DUPLICATE_EVENT`, NO SHALL evaluar ni cambiar el estado, NO SHALL crear incidente y SHALL auditar el rechazo.
5. WHEN una solicitud se acepta THEN el sistema SHALL persistir por robot la última solicitud aceptada (sesión, secuencia, destino y fecha).
6. WHEN la UI envía solicitudes THEN SHALL incrementar `sequence` por sesión de forma automática; el operador no la escribe.
7. WHEN se completa una solicitud THEN la UI SHALL mostrar en el panel "Telemetría" el JSON de la última solicitud enviada y de la respuesta recibida, sin transformarlo.
8. **[RC-01 rev2]** WHEN se rechaza una solicitud por `INVALID_SESSION` o `DUPLICATE_EVENT` THEN el rechazo SHALL quedar en `audit_log` aunque la respuesta sea `409`: el rechazo es un resultado tipado del servicio, no una excepción que revierta la transacción (B-5).
9. **[RC-01 rev2]** WHEN se consulta un robot (`GET /api/robots/:robotId` o `.../state`) THEN la respuesta SHALL incluir `lastRequest` (`{ sessionId, sequence, destination, acceptedAt }` o `null`) de la sesión vigente.

### Requirement 9 [RC-01]: Vista de incidentes (RF-09; HU-05 del prototipo, parte UI)
**User Story:** Como operador, quiero consultar los incidentes con su origen y decisión, para
revisar el comportamiento del Guardián.

#### Acceptance Criteria
1. WHEN el operador abre la vista "Incidentes" THEN la UI SHALL listar los incidentes de `GET /api/incidents` del más reciente al más antiguo, en una tabla Fecha · Robot · Regla · Zona · Decisión, con el contador "N eventos".
2. WHEN el operador selecciona un incidente THEN la UI SHALL mostrar su detalle (`GET /api/incidents/:id`): regla, código de decisión, tipo de colisión, origen, destino, estado resultante, motivo y snapshot de zonas.
3. WHEN no hay incidentes THEN la UI SHALL mostrar un estado vacío explícito.
4. WHEN se muestran los botones "Filtrar por severidad · HU-06" y "Exportar CSV · HU-07" THEN SHALL estar deshabilitados (HU reservadas), como en el prototipo. **[007]** Para HU-07: sustituido por la spec 007 CA-07.10 (el botón "Exportar CSV · HU-07" se habilita); HU-06 sigue deshabilitado (007 CA-07.14).
5. WHEN la UI muestra un incidente THEN NO SHALL modificarlo ni recalcularlo: es de solo lectura.
6. **[RC-01 rev2]** WHEN existe un incidente por pérdida de señal (`rule = R-SIGNAL-01`, `decisionCode = POSITION_QUALITY_LOST`, sin zona) THEN la tabla SHALL mostrarlo como cualquier otro, con "—" en la columna Zona.

### Requirement 10 [RC-01]: Supervisión multi-robot y navegación (RF-10)
**User Story:** Como operador, quiero supervisar todos los robots en el plano y navegar entre
las vistas del prototipo, para provocar escenarios y ver la decisión del Guardián.

#### Acceptance Criteria
1. WHEN el operador abre la aplicación THEN la barra lateral SHALL ofrecer: Supervisión, Robots simulados, Zonas y reglas e Incidentes. **[RC-01 rev3]** SHALL ofrecer **solo** esas 4 entradas: las vistas "Visión general" y las del grupo "Ingeniería · SDD" del prototipo están fuera de alcance (§7). **[RC-01 rev4] (M-9)** Al abrir la aplicación sin ruta, o con una ruta desconocida, SHALL mostrarse "Supervisión" (`#/supervision`), que sustituye a "Visión general" como vista inicial. **[RC-01 rev5] (M4-1)** La barra lateral **no** muestra esas vistas de ninguna forma: ni deshabilitadas, ni con etiquetas como «Fuera del MVP» o «reservado», ni el encabezado del grupo «Ingeniería · SDD». (La tarjeta «Fuera del MVP» del catálogo de reglas de la spec 001 está dentro de «Zonas y reglas», no en la barra lateral.)
2. WHEN el operador abre "Supervisión" THEN el plano SHALL mostrar todos los robots con su posición y su color por estado (activo azul `#3176d2`, vigilante morado `#665dd3`, `SAFE_STOP` rojo `#bd4954`, `DEGRADED` gris `#8893a2`) y un selector de robot; el clic y las coordenadas aplican al robot seleccionado.
3. WHEN la vista "Supervisión" está abierta THEN SHALL mostrar los indicadores: robots activos, decisiones de parada (`DENIED`), solicitudes procesadas y zonas restringidas, calculados a partir de datos de la API. **[RC-01 rev3] (N-12)** "Decisiones de parada" cuenta solo los incidentes con regla `R-ZONA-01` o `R-DATA-01` (decisiones `DENIED` del vigilante); los incidentes `R-SIGNAL-01` se cuentan en un indicador aparte, "Pérdidas de señal". **[RC-01 rev2]** "Solicitudes procesadas" es `lastRequest.sequence` del robot seleccionado (0 si `lastRequest` es `null`), tal como lo devuelve la API; la UI no lleva contadores propios (M-7).
4. WHEN el operador pulsa "⚠ Enviar a escaleras" THEN la UI SHALL fijar como destino del robot seleccionado un punto dentro de la zona "Escaleras" y solicitar el movimiento; IF "Escaleras" no está activa THEN SHALL avisar como el prototipo, sin decidir nada por su cuenta.
5. WHEN el operador pulsa "Liberar parada" THEN la UI SHALL llamar a `recover` del robot seleccionado (R11).
6. **[RC-01 rev2]** WHEN el operador pulsa "⌁ Perder conexión" THEN la UI SHALL enviar `POST /api/robots/:robotId/position` con `{ quality: "MISSING" }` para el robot seleccionado y mostrar el estado y la calidad que devuelva la API (el vigilante de la 002 lo lleva a `DEGRADED` y crea el incidente `R-SIGNAL-01` si estaba en `IDLE`) (Q-B).
7. **[RC-01 rev2]** WHEN el operador pulsa "↻ Recuperar señal" THEN la UI SHALL enviar una lectura `{ quality: "RELIABLE", position }` con la posición **devuelta por la API** para ese robot (la UI no la calcula); después el operador libera la parada con "Liberar parada" (`recover`). IF la API responde `409 POSITION_CONFLICT` THEN la UI SHALL mostrarlo tal cual (Q-B).

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
> | `POST` | `/api/robots/:robotId/position` | 002 | Lectura de posición. **[RC-01 rev2]** La UI la usa en "Perder conexión" (`MISSING`) y "Recuperar señal" (`RELIABLE` con la posición actual) |
> | `GET` | `/api/incidents?robotId=` | 002 | Incidentes, del más reciente al más antiguo |
> | `GET` | `/api/incidents/:id` | 002 | Detalle con `zonesSnapshot` |
>
> Entidad `Robot` (lectura):
> ```json
> {
>   "id": 1, "name": "Aspiradora A1", "type": "VACUUM", "createdAt": "2026-11-22T00:00:00.000Z",
>   "state": "IDLE", "position": { "x": 120, "y": 90 }, "positionQuality": "RELIABLE"
> }
> ```
> `POST /api/robots/:robotId/move` (request):
> ```json
> { "destination": { "x": 250, "y": 175 }, "sessionId": "5f1c…", "sequence": 7 }
> ```
> Respuestas: las de la spec 002 (`AUTHORIZED`/`DENIED` 200, `REJECTED` 409), más `409
> INVALID_SESSION` y `409 DUPLICATE_EVENT` (R8). El contrato original se conserva abajo como
> histórico.
>
> **[RC-01 rev2]** La entidad `Robot` y `GET /api/robots/:robotId/state` incluyen `lastRequest`
> (`{ "sessionId", "sequence", "destination", "acceptedAt" }` o `null`). `POST /api/robots` puede
> responder `409 ROBOT_START_IN_RESTRICTED_ZONE`; un `move` con payload inválido responde
> `422 INVALID_MOVE_REQUEST`. Los `409` de rechazo (`INVALID_SESSION`, `DUPLICATE_EVENT`,
> `ROBOT_START_IN_RESTRICTED_ZONE`) se responden con `{ code, message }` y quedan auditados.
>
> **[RC-01 rev4]** (M-1) El ejemplo de `Robot` usaba A1 en (160, 123); queda sustituido por
> (120, 90) (Q-I). (Decisión 1) `POST /api/robots` puede responder además
> `409 ROBOT_START_NOT_VERIFIABLE` con cuerpo `{ code, message, cause: "ZONE_DATA_UNAVAILABLE" }`.
> (M-2) `POST /api/robots/:robotId/sessions` lo monta esta spec (`robotsRoutes`); la spec 002
> monta solo `state|move|recover|position` bajo `/api/robots/:robotId`.

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
| 422 | `INVALID_MOVE_REQUEST` | **[RC-01 rev2]** Payload de `POST /api/robots/:robotId/move` inválido (sustituye a `INVALID_DESTINATION` en el endpoint nuevo) |
| 409 | `ROBOT_START_IN_RESTRICTED_ZONE` | **[RC-01 rev2]** La posición inicial del robot cae en una zona activa; no se crea nada; auditado |
| 409 | `ROBOT_START_NOT_VERIFIABLE` | **[RC-01 rev4]** Las zonas no se pueden leer al validar la posición inicial; incluye `cause: ZONE_DATA_UNAVAILABLE`; no se crea nada; auditado (decisión humana) |
| 409 | `POSITION_CONFLICT` | **[RC-01 rev2]** Lectura `RELIABLE` con una posición distinta de la actual (spec 002); la UI lo muestra tal cual |

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
  responde `200 AUTHORIZED` (~~`state: MOVING`~~ **[RC-01 rev4] (I-7)** `state: IDLE`), el robot aparece en el destino y
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
  plano de "Supervisión" en (120, 90) con estado `IDLE`. **[RC-01 rev4]** Si A1 sigue en (120, 90),
  los dos marcadores aparecen superpuestos (limitación aceptada, R7.11) y se distinguen por su
  etiqueta y por el selector de robot.
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

### 6.2 [RC-01 rev2] Criterios añadidos en la revisión 2
Cubren los requisitos que no tenían CA (M-6) y las decisiones Q-B, Q-D, Q-E y B-5.

- **CA-03.18 (R7.5)** Dado un robot registrado, cuando el operador recarga la aplicación,
  entonces el robot sigue en la lista de "Robots simulados" y en el plano con el mismo estado.
- ~~**CA-03.19 (R7.6, Q-E)** Dada una base nueva, cuando arranca el backend, entonces existen
  `Aspiradora A1` (`VACUUM`) en (160, 123) y `Vigilante V2` (`GUARD`) en (488, 290), ambos `IDLE`
  y `RELIABLE`. Dada una base existente, cuando se aplican las migraciones, entonces
  `Aspiradora A1` conserva la posición, el estado y la calidad de la fila anterior.~~
  *(Sustituido por RC-01 rev3, Q-I.)*
- **CA-03.19 [RC-01 rev3] (R7.6, Q-I)** Dada una base nueva, cuando arranca el backend, entonces
  existen `Aspiradora A1` (`VACUUM`) en (120, 90) y `Vigilante V2` (`GUARD`) en (488, 290), ambos
  `IDLE` y `RELIABLE`. Dada una base existente, cuando se aplican las migraciones, entonces
  `Aspiradora A1` conserva la posición, el estado y la calidad de la fila anterior y
  `Vigilante V2` se crea en (488, 290).
- **CA-03.20 (R7.7)** Dado un `robotId` que no existe, cuando se consulta
  `GET /api/robots/:robotId` (o cualquiera de sus subrutas), entonces la API responde
  `404 ROBOT_NOT_FOUND`.
- **CA-03.21 (R7.8)** Dado el operador en "Robots simulados", cuando abre el modal "＋ Registrar
  robot", entonces ve los campos nombre y tipo (Aspiradora/Vigilante) y una tarjeta por robot con
  nombre, tipo, estado, calidad y posición.
- **CA-03.22 (R7.9, Q-D)** Dada la zona "Sala" activa, cuando el operador registra un robot,
  entonces la API responde `409 ROBOT_START_IN_RESTRICTED_ZONE`, no se crea el robot ni su
  estado, la UI muestra el código y existe la fila del rechazo en `audit_log`.
- **CA-03.23 (R8.6)** Dada una sesión nueva, cuando el operador envía tres movimientos, entonces
  las solicitudes llevan `sequence` 1, 2 y 3 sin que el operador las escriba.
- **CA-03.24 (R8.7)** Dada una solicitud completada, cuando el operador mira el panel
  "Telemetría", entonces ve el JSON de la solicitud enviada y de la respuesta recibida, idéntico
  al intercambiado con la API.
- **CA-03.25 (R8.8, B-5)** Dada una solicitud con `sequence` repetida o con una sesión no
  vigente, cuando la API responde `409 DUPLICATE_EVENT` o `409 INVALID_SESSION`, entonces existe la
  fila correspondiente en `audit_log` después de la respuesta.
- **CA-03.26 (R9.3)** Dada una base sin incidentes, cuando el operador abre "Incidentes",
  entonces ve un estado vacío explícito y el contador "0 eventos".
- **CA-03.27 (R9.4)** Dada la vista "Incidentes", cuando se muestra, entonces los botones
  "Filtrar por severidad · HU-06" y "Exportar CSV · HU-07" están deshabilitados. **[007]** HU-07: sustituido por la spec 007 CA-07.10; queda solo HU-06 deshabilitado (007 CA-07.14).
- **CA-03.28 (R10.1)** Dada la aplicación abierta, cuando se muestra la barra lateral, entonces
  ofrece Supervisión, Robots simulados, Zonas y reglas e Incidentes, y cada entrada abre su vista.
  **[RC-01 rev3]** Y no ofrece "Visión general" ni ninguna entrada del grupo "Ingeniería · SDD".
  **[RC-01 rev4]** Tampoco las muestra deshabilitadas, con etiquetas como "Fuera del MVP" o "reservado",
  ni muestra el encabezado del grupo "Ingeniería · SDD": esas vistas no aparecen en la UI de ninguna forma.
  **[RC-01 rev5] (M4-1)** La verificación se hace sobre el contenedor de la barra lateral: ningún nodo con
  los textos de las vistas excluidas ni «Fuera del MVP»/«reservado», y ninguna entrada deshabilitada. La
  tarjeta «Fuera del MVP» del catálogo de reglas (spec 001) está en «Zonas y reglas» y no cuenta.
- **CA-03.29 (R10.3, M-7)** Dado un robot con `lastRequest.sequence = 3`, cuando el operador lo
  selecciona en "Supervisión", entonces el indicador "Solicitudes procesadas" muestra 3; con
  `lastRequest = null` muestra 0.
- **CA-03.30 (R4.6)** Dado que la API devuelve `DEGRADED` y `MISSING`, cuando la UI pinta el
  robot, entonces lo muestra en gris `#8893a2` con el estado y la calidad recibidos, sin
  deducirlos.
- **CA-03.31 (R10.6, Q-B)** Dado un robot en `IDLE`, cuando el operador pulsa "⌁ Perder conexión",
  entonces la UI muestra el robot en `DEGRADED` con calidad `MISSING` y en "Incidentes" aparece un
  incidente `R-SIGNAL-01` de ese robot.
- **CA-03.32 (R10.7, Q-B)** Dado un robot en `DEGRADED` por pérdida de señal, cuando el operador
  pulsa "↻ Recuperar señal" y después "Liberar parada", entonces la calidad pasa a `RELIABLE`,
  `recover` responde `transitioned: true` y el robot queda en `IDLE`.
- **CA-03.33 [RC-01 rev3] (R10.3, N-12)** Dados un incidente `R-ZONA-01` y otro `R-SIGNAL-01`,
  cuando el operador abre "Supervisión", entonces "Decisiones de parada" muestra 1 y
  "Pérdidas de señal" muestra 1.
- **CA-03.34 [RC-01 rev3] (R8.1, N-13)** Dado un robot, cuando el operador pulsa "↻ Nueva sesión",
  entonces la API responde `201 { sessionId }` y `audit_log` contiene una fila `SESSION_STARTED`
  de ese robot.

### 6.3 [RC-01 rev4] Criterios añadidos en la revisión 4

- **CA-03.35 [RC-01 rev4] (R7.9, decisión humana 1)** Dado que el repositorio de zonas no se puede
  leer, cuando el operador registra un robot, entonces la API responde
  `409 ROBOT_START_NOT_VERIFIABLE` con `cause: ZONE_DATA_UNAVAILABLE`, no hay filas nuevas en
  `robots` ni en `robot_state`, existe la fila del rechazo en `audit_log` (con la misma `cause` en
  `detail`) y la UI muestra el código y la causa recibidos.
- **CA-03.36 [RC-01 rev4] (R7.10, M-10)** Dado un nombre ya registrado y la zona "Sala" activa,
  cuando el operador registra un robot con ese nombre, entonces la API responde
  `409 ROBOT_NAME_DUPLICATE` (la validación del nombre va antes que la de la posición) y no se
  añade ninguna fila a `audit_log`.
- **CA-03.37 [RC-01 rev4] (R10.1, M-9)** Dada la aplicación abierta sin ruta, cuando se carga,
  entonces se muestra "Supervisión" (`#/supervision`).

## Glossary

| Término | Definición |
|---------|------------|
| Vigilante | Componente del backend que decide si un movimiento es seguro; independiente de la UI. |
| Decisión | ~~Resultado del vigilante: `ALLOW`, `PREVENTIVE_STOP` o `DENIED_SAFE_STOP`.~~ *(Sustituido por RC-01 rev3 (N-10): `AUTHORIZED`, `DENIED` o `REJECTED` con su `code`, según la spec 002.)* |
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
> pregunta Q-B. *(Lo del botón queda sustituido por RC-01 rev2/rev3: Q-B resuelta, R10.6.)* Los estados `DEGRADED` y `RECOVERING` dejan de estar "fuera": la UI los
> **muestra** cuando la API los devuelve, aunque no los provoque.

> **[RC-01 rev2]** La **pérdida de señal** sale de lo reservado: la UI ofrece "⌁ Perder
> conexión" y "↻ Recuperar señal" (R10.6, R10.7), que solo envían la señal explícita ya en
> alcance en la spec 002. La **inyección de fallos de sensor** (simular sensores defectuosos,
> lecturas aleatorias, latencias) **sigue reservada**. La autenticación pasa de "fuera de alcance"
> a **riesgo aceptado** (§11b).

- **Inyección de fallos de sensor** (reservada para demo en vivo).
- **Alerta A-04** (reservada).
- **Prueba T-18** (reservada).
- ~~Estados `DEGRADED` y `RECOVERING` de la máquina de estados (dependen de los sensores).~~ *(Sustituido por RC-01 rev3 (N-10): se muestran, R4.6.)*
- Trayectorias curvas y movimiento con pasos intermedios/animación física.
- ~~Autenticación y autorización.~~ *(Sustituido por RC-01 rev3 (N-10): riesgo aceptado, §11b.)*

> **[RC-01 rev3] Vistas del prototipo fuera de alcance (decisión del equipo, 2026-11-23).**
> - **"Visión general"** (portada con indicadores, mini mapa y eventos recientes).
> - Todo el grupo **"Ingeniería · SDD"**: Backlog 5 + 5, Proceso SDD, Agentes de IA, Arquitectura
>   y DevOps y seguridad.
>
> Motivo: ninguna HU (ni de línea base ni reservada) las cubre; son material de presentación del
> proceso y su evidencia vive en el repositorio (specs, agentes, pruebas, CI). Además contienen
> afirmaciones que contradicen el stack (Next.js, PostgreSQL, Prisma) o simulaciones
> ("DEMO DE FLUJO · NO IA REAL", "EJECUCIÓN NO CONECTADA A CI") cuya implementación fabricaría
> evidencia (constitución art. XV). Los indicadores de la portada no se pierden: viven en
> "Supervisión" (R10.3).

### [RC-01 rev3] Cobertura de las vistas del prototipo

| Vista del prototipo | Cobertura |
|---------------------|-----------|
| Supervisión en vivo (HU-03/04/05) | Esta spec: R8, R10, R11; vigilante de la spec 002 |
| Robots simulados (HU-01) | Esta spec: R7 |
| Zonas y reglas (HU-02) | Spec 001 |
| Incidentes (HU-05; filtros HU-06/07 deshabilitados) | Esta spec: R9; contrato de la spec 002 |
| Visión general | **Fuera de alcance** (rev3) |
| Ingeniería · SDD: Backlog, Proceso SDD, Agentes de IA, Arquitectura, DevOps | **Fuera de alcance** (rev3) |

---

## 8. Dependencias

> **[RC-01]**
> - **spec 002**: vigilante por robot (`/api/robots/:robotId/state|move|recover|position`),
>   `robot_state` con una fila por robot, incidentes con `robot_id` y `rule`, `audit_log`,
>   `state_transition_log` y la validación de sesión/secuencia dentro del flujo de `move`.
> - **spec 001**: catálogo `RULES` (constante de dominio) que se muestra en incidentes.

- **spec `001-restricted-zones`**: modelo geométrico, `Zone`, `isCollision`, `CollisionType`.
- ~~**spec del vigilante (reglas)**: mapeo de tipo de colisión a decisión/razón.~~ *(Sustituido por RC-01 rev3 (N-10): es la spec 002, detallada arriba.)*
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
> **[RC-01 rev3] (N-10)** Tras RC-01, el código es: backend de catálogo y sesiones
> (`robotsRoutes`, `robotCatalogService`, `sessionService`, `sequenceRule`) y frontend
> (`SimulationPage`, `RobotsPage`, `IncidentsPage`); las pruebas usan `/api/robots/*` e
> `/api/incidents`. `/api/simulation` se retira.

---

## 10. Compuerta Fase 1 (ENTENDER)

- [x] El humano aprueba explícitamente este `requirements.md` antes de pasar a DISEÑAR. (2026-11-22)
- [ ] **[RC-01 rev4] (N-11)** El humano aprueba el refuerzo RC-01 de este `requirements.md`
  (incluidas las revisiones 2, 3, 4 y 5) tras la revisión del analista.

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

> **[RC-01 rev2] Resueltas por el humano (2026-11-23):** Q-A → deuda documentada (§11b);
> Q-B → se habilitan "Perder conexión" y "Recuperar señal", y la pérdida crea incidente
> `R-SIGNAL-01` (R10.6, R10.7); Q-C → 001 y 002 aprobadas en lo implementado, esta spec con el
> estado de la cabecera; el RC-01 se aprueba tras la revisión del analista. Q-D (alta en zona
> activa → 409), Q-E (posiciones), Q-F (una sola migración de la UI), Q-G (migraciones en orden
> de entrega) y Q-H (fila base del registro de transiciones, spec 002) también están decididas.

> **[RC-01 rev3] Resuelta por el humano (2026-11-23):** **Q-I** → `Aspiradora A1` empieza
> siempre en (120, 90) (la fila actual de `robot_state`), sin lógica de detección de base nueva
> (sustituye a la Q-E en lo que respecta a A1). También se decidió excluir del producto
> "Visión general" y el grupo "Ingeniería · SDD" (§7).

> **[RC-01 rev4] Resueltas por el humano (2026-11-23):** (1) alta con zonas no legibles →
> `409 ROBOT_START_NOT_VERIFIABLE` con `cause` (R7.9, CA-03.35); (2) `/api/robots` se monta de forma
> aditiva antes de la UI dentro de la rama de trabajo, para que cada tarea termine en verde
> (tasks); (3) filas antiguas de `audit_log` con `robot_id` NULL (spec 002); (4) se acepta que los
> robots empiecen superpuestos en (120, 90) (R7.11).

## 11b. Riesgos aceptados [RC-01 rev2]

| Riesgo | Por qué se acepta | Mitigación actual |
|--------|-------------------|-------------------|
| **Sin autenticación del operador** (Q-A). Cualquier cliente puede iniciar una sesión e invalidar la del operador (denegación de servicio, nunca movimiento), registrar robots o pulsar "Perder conexión". La HU-02/HU-05 del prototipo piden autorización. | Decisión del humano: deuda documentada, se aborda en un bloque posterior (propuesta de la spec 001 §11). | Todo rechazo y toda señal queda en `audit_log`/`state_transition_log`, aunque sin actor. |
| `packages/backend/data/` sigue versionada (decisión previa del humano). | Decisión del humano. | Las migraciones se aplican en orden de entrega y `migrate.ts` rechaza números fuera de orden (spec 002). |

## 12. Registro de cambios

| Fecha | Cambio | Resumen |
|-------|--------|---------|
| 2026-11-22 | Aprobación | requirements.md aprobado por el humano (compuerta Fase 1). |
| 2026-11-22 | **RC-01** (pendiente de aprobación) | Convergencia con el prototipo: un solo vigilante (retirada de `/api/simulation/*`, `decideMovement` y `reset`; `recover` validado), catálogo de robots (R7), sesión y secuencia (R8), vista de incidentes (R9), supervisión multi-robot y navegación (R10), un solo vigilante en la UI (R11). CA-03.1–03.5, 03.7 y 03.8 sustituidos; CA-03.6 ampliado; CA-03.9–03.17 nuevos. RF-02.1/02.2, RF-03 y RF-05 sustituidos por la spec 002. |
| 2026-11-23 | **RC-01 rev2** (pendiente de aprobación) | Resuelve el informe del analista sobre RC-01 con las decisiones del humano. Detalle por hallazgo abajo. |
| 2026-11-23 | **RC-01 rev3** (pendiente de aprobación) | Ronda final del analista (N-1..N-18), Q-I y vistas excluidas. Detalle abajo. |
| 2026-11-23 | **RC-01 rev4** (pendiente de aprobación) | Pasada del analista sobre la rev3 local (B-1, I-1..I-7, M-1..M-11) y 4 decisiones del humano. Detalle abajo. |
| 2026-11-24 | **007** (aprobado por el humano) | HU-07 se implementa como demo en vivo (spec `specs/007-export-incidents-csv`). RF-09.4 y CA-03.27 quedan sustituidos para HU-07 por 007 CA-07.10; HU-06 sigue deshabilitado (007 CA-07.14). |

### RC-01 rev2 — resolución por hallazgo

| Hallazgo | Resolución en esta spec |
|----------|-------------------------|
| B-1 plan con ciclos | tasks.md: plan U1/U2 sin dependencias hacia delante; `007_create_robots.sql` en el paso 2 de U1, antes de que la 002 la necesite. |
| B-2 doble migración de la UI | Q-F: una sola migración, directa a `/api/robots/:robotId/*` (R11.1; tasks U1 paso 4). |
| B-3 `robot_sessions` y tipos duplicados | Esquema único con dueña esta spec (design); tipos `MoveCommand`, `moveCommandSchema`, `LastRequest`; `sessionService.startSession`; la 002 lo cita. |
| B-4 zona del incidente | No aplica a esta spec (columna `zone_name` en la 002); la vista la muestra (R9.1). |
| B-5 rechazos auditados | R7.9, R8.8; `acceptRequest` y el alta devuelven resultados tipados; CA-03.22, CA-03.25. |
| I-1 dos vigilantes en integraciones intermedias | Unidad U1 única: montaje y retirada en el mismo paso (tasks U1 paso 5). |
| I-2 orden de migraciones | 007 y 012 numeradas en el orden de entrega de U1; el endurecimiento de `migrate.ts` es de la 002. |
| I-3 fila base del registro de transiciones | No aplica a esta spec (Q-H, spec 002). |
| I-4 posiciones iniciales | Q-E: R7.6 y CA-03.19. |
| I-5 `ruleForDecision` duplicada | No aplica a esta spec (la UI solo muestra `rule`; única definición en la 001). |
| I-6 `initRobot` como teletransporte | R7.4: `initRobot` (spec 002) en la misma transacción que el alta; el `INSERT` simple es de la 002. |
| I-7 robot registrado en zona activa | Q-D: R7.9, CA-03.22. |
| I-8 pruebas afectadas sin identificar | tasks.md: cada tarea RC lista los archivos de prueba que cambia o retira. |
| I-9 métodos y alias de la 003 en el repositorio de la 002 | tasks U1 paso 5 (retirada de `RobotSnapshot`, `moveRequestSchema` y `simulation.schema`), coordinada con la 002. |
| M-1 radio y margen | No aplica a esta spec. |
| M-2 estados de aprobación | Cabecera según Q-C. |
| M-3 restos sin marcar en la 002 | No aplica a esta spec. |
| M-4 `BUSY` | No aplica a esta spec (la UI muestra el `code` recibido). |
| M-5 código de payload inválido | R6.1 y catálogo: `422 INVALID_MOVE_REQUEST`. |
| M-6 requisitos sin CA | §6.2: CA-03.18 a CA-03.30. |
| M-7 indicador contradictorio | R10.3: `lastRequest.sequence` de la API; CA-03.29; DD-121 corrige DD-114. |
| M-8 línea "NNN" de la 001 | No aplica a esta spec. |
| M-9 contradicción sobre el alta | design §3: el alta invoca `initRobot`; se elimina la mención a "la API del repositorio de estado". |
| M-10 fechas no ISO | `robots` y `robot_sessions` usan `strftime(...'Z')`; el resto es de la 002. |
| M-11 nombre `Incident` | No aplica a esta spec. |
| M-12 steering desalineado | No aplica a esta spec (observación en la 001). |

### RC-01 rev3 (2026-11-23, pendiente de aprobación)

Ronda final del analista sobre d84eb08 (N-1..N-18) y decisiones del humano. Lo nuevo va marcado
**[RC-01 rev3]**.

| Hallazgo / decisión | Resolución en esta spec |
|---|---|
| Q-I (N-1) A1 en base nueva | R7.6 y CA-03.19 reescritos: A1 siempre con la fila actual (120, 90); V2 en (488, 290); sin detección de base nueva. DD-124 (design). |
| Vistas excluidas | §7: "Visión general" y "Ingeniería · SDD" fuera de alcance, con motivo; tabla de cobertura de vistas; R10.1 y CA-03.28 (solo 4 entradas). DD-125. |
| N-2 validación del alta | R7.9: `checkStartPosition` (002) antes del `INSERT`; `initRobot` solo crea. Design §alta, DD-126; tasks RC-9/RC-10. |
| N-3 `audit_log` sin robot | No aplica a esta spec (migración `011` de la 002); el alta lo consume. |
| N-4 una sola unión move ↔ sesiones | Design: `acceptRequest(robotId, cmd): ServiceResult<LastRequest>` con el `ServiceResult<T>` de la 002. DD-127; tasks RC-7/RC-8. |
| N-5 ciclos dentro de los pasos | Tasks: RC-3/RC-4 → RC-3a/RC-4a (`007`) y RC-3b/RC-4b (`012`); paso 3 → 3a (sesiones) y 3b (catálogo). Grafo alineado con el "Orden intercalado de U1" de la 002. |
| N-6 convivencia tras la `008` | No aplica a esta spec (002 RC-5). |
| N-7 copia de `robot_sessions` en la 002 | No aplica (la definición única sigue aquí). |
| N-8 `IncidentCode` | No aplica (lo define la 002); la vista de incidentes muestra `decisionCode` tal cual. |
| N-9 `denialRule` | No aplica a esta spec. |
| N-10 restos sin marcar | Marcados como sustituidos: introducción, glosario ("Decisión"), §7 (DEGRADED/RECOVERING, autenticación, botón), §8 (spec del vigilante), §9 (trazabilidad); design: overview y dependencias. |
| N-11 casillas de compuerta | Design: casilla de Q-A/Q-B/Q-C marcada (resueltas el 2026-11-23). |
| N-12 indicador de paradas | R10.3, CA-03.33: "Decisiones de parada" (`R-ZONA-01`/`R-DATA-01`) y "Pérdidas de señal" (`R-SIGNAL-01`). DD-128; tasks RC-23. |
| N-13 `SESSION_STARTED` | R8.1, CA-03.34; design `startSession`; tasks RC-7/RC-8. |
| N-14 una sola tarea dueña del montaje | Tasks: el montaje y la retirada son de la 002 RC-20; RC-21 pasa a "UI y pruebas de la UI tras la retirada" y depende de ella; `pointSchema` se traslada a `schemas/point.schema.ts` en la 002 RC-20. |
| N-15 CHECKs de `008`/`009` | No aplica a esta spec. |
| N-16 redacción de R10.5 (002) | No aplica a esta spec. |
| N-17 la semilla no pasa por `initRobot` | Design (Data Models): A1 y V2 los crea la `008`; su registro es `MIGRATION_BASELINE`, no T9. |
| N-18 numeración de criterios (002) | No aplica a esta spec. |

### RC-01 rev4 (2026-11-23, pendiente de aprobación)

Pasada del analista sobre la rev3 local y decisiones del humano. Lo nuevo va marcado
**[RC-01 rev4]**.

| Hallazgo / decisión | Resolución en esta spec |
|---|---|
| Decisión 1: alta con zonas no legibles (I-5) | R7.9: `409 ROBOT_START_NOT_VERIFIABLE` con `cause: ZONE_DATA_UNAVAILABLE`; catálogo de errores; CA-03.35; DD-129; tasks RC-9 y RC-18. Decisión humana (art. XIII). |
| Decisión 2: E2E en rojo (I-2) | Tasks: la UI del paso 4 depende del montaje aditivo de `/api/robots` que hace la 002 al final del paso 3; el paso 5 solo retira lo antiguo. DD-130. |
| Decisión 3: filas antiguas de `audit_log` (B-1) | No aplica a esta spec (migración `011` de la 002). |
| Decisión 4: posición compartida (M-11) | R7.11 (limitación aceptada) y nota en CA-03.9. DD-131. |
| B-1 migración `011` | No aplica a esta spec. |
| I-1 typecheck en la fila 18 | Tasks: RC-21 (retirar `simulationApi`, `useSimulation` y re-exportaciones de `types/index.ts`) va **antes** de la 002 RC-20. |
| I-2 E2E en rojo | Ver decisión 2. RC-20 pasa a "rojo esperado" justo antes de la 002 RC-20. |
| I-3 estado para auditar en sesiones | Design y tasks RC-7/RC-8: `acceptRequest(robotId, cmd, currentState)`; `startSession` lee el estado con `robotRepository.getStatus` (002 RC-10, que va antes). Texto rev2 que decía que el `move` de la 002 escribe la fila de `audit_log`, marcado como sustituido. DD-132. |
| I-4 lectura de `lastRequest` | `sessionService.getLastRequest(robotId)` (tasks RC-7/RC-8, RC-11); DD-132. |
| I-5 decisión sin validar | Ver decisión 1. |
| I-6 grafo contradice la tabla | Tasks: grafo rev4 copiado del orden de la tabla de la 002 (con los cambios de la rev4). |
| I-7 `AUTHORIZED` con `MOVING` | CA-03.1 y nota de R3: `state: IDLE`. DD-133. |
| M-1 restos sin marcar | Ejemplo de `Robot` con A1 en (120, 90). |
| M-2 dos routers para `/sessions` | Esta spec es la dueña (`robotsRoutes`); design del árbol corregido; nota en el contrato. DD-135. |
| M-3 referencias a §8 en la 001 | No aplica a esta spec. |
| M-4 IDs obsoletos | Tasks: "se retira en RC-23" → RC-21; RC-2 sin dependencia de la 001 (fila 3 de la tabla); cabecera con rev3/rev4. |
| M-5 `zoneName` opcional | No aplica a esta spec. |
| M-6 retorno de `initRobot` | No aplica a esta spec (la 002 fija `void`). |
| M-7 controller antiguo con `robotId = 1` | No aplica a esta spec. |
| M-8 Testing Strategy de la 002 | No aplica; la de esta spec añade los casos de la rev4. |
| M-9 ruta por defecto | R10.1 y CA-03.37: `#/supervision`; design de `App.tsx`. DD-134. |
| M-10 orden de validación del alta | R7.10 y CA-03.36. |
| M-11 posición compartida | Ver decisión 4. |
| N-10/N-11 restantes | §10: casilla de aprobación del RC-01; design: referencia a las DD vigentes (DD-108..DD-135). |
| Vistas excluidas (refuerzo) [RC-01 rev4] | CA-03.28: las vistas excluidas no aparecen de ninguna forma en la barra lateral (ni deshabilitadas, ni con "Fuera del MVP", ni el encabezado del grupo). Decisión del humano (2026-11-23). |

### RC-01 rev5 (2026-11-23, pendiente de aprobación)

Pasada del analista sobre la rev4 local y decisiones del humano. Lo nuevo va marcado
**[RC-01 rev5]**.

| Hallazgo / decisión | Resolución en esta spec |
|---|---|
| Decisión 1: unidad de "verde" = par prueba roja → implementación (N4-2) | Tasks: marcas `[par: …]` en cada tarea, nota con la lista de pares y el orden de ejecución del paso 4; RC-11 se ejecuta antes de RC-10 y forma un trío (RC-9 + RC-11 + RC-10). DD-136, DD-137. |
| Decisión 2: vía temporal `moveLegacy` (N4-4) | No aplica a esta spec salvo la aserción de RC-20 de que `moveLegacy` ya no existe tras la 002 RC-20; la define la 002 (RC-16, RC-20). |
| N4-1 E2E en rojo en el paso 4 | Tasks: RC-15 adapta `simulation.spec.ts` al vocabulario y RC-19 a las rutas y la barra de 4 entradas; RC-22 queda como ampliación; design: texto de "pasa en todas las tareas" corregido. DD-138. |
| N4-2 tareas "prueba roja primero" que terminaban en rojo | Ver decisión 1. RC-11 (prueba roja después de su implementación) se mueve antes de RC-10. |
| N4-3 restos sin marcar | Tasks: tachados o sustituidos los textos del bloque rev3 ("una sola tarea dueña: la 002 RC-20", "[002·U1-5] montaje", "[002·RC-20] … dueña única") y RC-21 reescrita (solo UI antigua; requiere RC-12..RC-19 y 002 RC-17b; va antes de la 002 RC-20); design: nota del paso 5 sustituida. |
| N4-4 `/api/robot/move` sin sesión | Ver decisión 2. |
| M4-1 CA-03.28 | R10.1 y CA-03.28 (verificación sobre el contenedor de la barra); design: comentario de `App.tsx` y DD-125; tasks RC-18 con aserciones explícitas; aclaración de que la tarjeta «Fuera del MVP» de la 001 no está en la barra lateral. |
| M4-2 restos de la rev3 en la 002 | No aplica a esta spec. |
| M4-3 "rojo esperado" | Tasks: RC-20 dice "dentro de la 002 RC-20, paso (0)"; nodos C3 y C4 fusionados en el grafo "Dependencias RC-01 rev5". |
| M4-4 columnas de `audit_log` | No aplica a esta spec (migración `011` de la 002). |
| M4-5 RC-11 de la 002 | No aplica a esta spec. |

### RC-01 rev6 — Pasada final del analista sobre la rev5 local (2026-11-23, propuesto) [RC-01 rev6]
Decisiones del humano (2026-11-23, aceptó las recomendaciones del coordinador): **(1)** `#/supervision` se
mantiene como ruta por defecto (CA-03.37) y los E2E existentes son `simulation.spec.ts` y `rooms.spec.ts`;
`FloorPlan` usa un `data-testid` por robot, `robot-<id>` (N5-1); **(2)** la prueba de dos robots de la 002
RC-17 pasa a RC-10 y RC-17 se retira (N5-3); **(3)** `moveLegacy` queda acotado a tres pruebas de la 002
(N5-2). Esta entrega no cambia ningún requisito funcional de la 003: solo el plan de tareas.

| Hallazgo | Resolución en la 003 |
|----------|----------------------|
| N5-1 E2E: `rooms.spec.ts` y testid de robot | Tasks: RC-15 fija `data-testid="robot-<id>"` y adapta `simulation.spec.ts` (y `SimulationPage.test.tsx`, `FloorPlan.test.tsx`) al robot seleccionado; RC-19 adapta `rooms.spec.ts` a `/#/zonas` y `simulation.spec.ts` a las rutas; RC-22 solo amplía. Design: DD-139 |
| N5-2 `moveLegacy` puede sobrevivir a RC-20 | No aplica a esta spec (002 RC-16, RC-18, RC-20); RC-20 de la 003 conserva su aserción |
| N5-3 RC-17 de la 002 nace en verde | Sin cambios en la 003: sus filas se renumeran (la tabla queda en 24 filas) y el grafo rev6 deja de citar 002 RC-17 |
| N5-4 tabla y grafos no idénticos | Tasks: RC-17 declara su dependencia de (RC-13 + RC-14) (`incidentsApi`); el grafo rev6 copia las dependencias de la tabla y marca las aristas extra como orden de ejecución (DD-140) |
| N5-5 «seis sentencias» | No aplica a esta spec (002 RC-5) |
| N5-6 restos de redacción | Tasks: reglas del plan (cada fila en verde; pasos 3 y 5) y encabezados de los pasos 3 y 5 marcados como sustituidos; estado de los tres documentos con rev2 a rev6 |
| N5-7 coherencia con `packages/` | Sin cambios: no se detectaron contradicciones con el código |
