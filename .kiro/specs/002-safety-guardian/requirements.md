# Requirements Document

**Spec:** `002-safety-guardian`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-04, HU-05
**Estado:** Aprobado (2026-11-23) en lo implementado (773823a); refuerzo RC-01 (rev2 + rev3 +
rev4 + rev5 + rev6) pendiente de aprobación humana

> Trazabilidad: Necesidad → Peligro STPA → Requisito → Regla → Historia → Prueba → Evidencia.
> Este documento captura **qué** debe hacer el sistema, no **cómo**.

## Introduction

Esta spec define el **vigilante de seguridad** de Guardián Hogar (HU-04 y HU-05): el
componente del backend que evalúa cada movimiento **antes** de autorizarlo y que gobierna la
máquina de estados del robot. El vigilante es independiente del frontend (constitución
art. III) y aplica el principio de **fallo seguro por defecto**: ante información
insuficiente o cualquier colisión, el robot entra en **parada preventiva** (`SAFE_STOP`) y
solo se recupera de forma **explícita y validada**.

El vigilante reutiliza el modelo geométrico y la función `isCollision` (con su
`CollisionType`) de la spec `001-restricted-zones`; no recalcula geometría. Esta spec aporta:
el orden de evaluación, la máquina de estados completa (IDLE, MOVING, SAFE_STOP, DEGRADED,
RECOVERING) con transiciones prohibidas, el registro de incidentes, la recuperación y el
reinicio seguro (ADR-10). La prueba **T-12** (28 escenarios) verifica la decisión sin
frontend ni base de datos real.

> **[RC-01] Refuerzo de convergencia con el prototipo.** Tras comparar las 5 HU del prototipo
> (`prototipo/Guardian_Hogar_Artifact_V2.html`) con lo implementado en 773823a, esta spec se
> refuerza en cinco frentes, descritos como **delta** sobre lo ya implementado:
> 1. **Vigilante único** (R10): esta spec es la única autoridad sobre el estado de los robots; se
>    retiran `/api/simulation/*` y el vigilante provisional de la spec 003, y con ellos el `reset`
>    sin validación (hallazgo B-1 del revisor de la HU-03).
> 2. **Registro de toda transición** con su causa (R9; constitución art. IV).
> 3. **Estado por robot** (R12): el catálogo de robots lo define la spec 003; aquí el estado,
>    las rutas `/api/robots/:robotId/*` y el arranque seguro pasan a ser por robot.
> 4. **Sesión y secuencia** de las solicitudes de movimiento (R11; HU-03 del prototipo).
> 5. **Incidentes consultables** con robot y regla (R5.5–R5.8; HU-05 del prototipo) y
>    endurecimiento de `recover` y de las lecturas de posición (R4, R8).
>
> **[RC-01 rev2]** Tras la revisión del analista (veredicto REQUIERE CAMBIOS sobre 5da075e) se
> fijan: un plan de entrega en dos unidades (U1 vigilante único + incidentes + robots y sesiones;
> U2 supervisión y zonas) sin integraciones intermedias con dos vigilantes; rechazos auditados que
> **no** se pierden por la reversión de la transacción (R5.10); incidente por pérdida de señal
> `R-SIGNAL-01` (R5.11); la zona persistida en el incidente; la fila base de transiciones
> `MIGRATION_BASELINE`; y las migraciones como escritoras autorizadas del esquema (R10.5).
>
> **[RC-01 rev3]** Tras la ronda final del analista (d84eb08): A1 empieza siempre en (120, 90)
> (Q-I); la posición de alta la valida el vigilante (`checkStartPosition`, R12.2) y `initRobot`
> solo inserta; una sola unión `move` ↔ sesiones (`sessionService.acceptRequest` de la spec 003,
> R11.6); el rechazo del alta se audita aunque el robot no exista (R5.10); tipo `IncidentCode`; y
> un orden intercalado único de U1 para las tres specs (tasks.md).

## 1. Historias de usuario

### HU-04 — Evaluación previa de cada movimiento
> Como **responsable de aseguramiento**, quiero que **cada movimiento se evalúe antes de
> autorizarse contra origen, destino y trayectoria completa**, usando el **modelo geométrico
> de la spec 001**.

### HU-05 — Parada preventiva y recuperación validada
> Como **responsable de seguridad**, quiero que **el robot entre en parada preventiva ante
> información insuficiente** y que **solo se recupere de forma explícita y validada**.

## 2. Máquina de estados

### 2.1 Estados
| Estado | Significado |
|--------|-------------|
| `IDLE` | Detenido en posición válida; listo para evaluar un movimiento. |
| `MOVING` | Movimiento autorizado en curso. |
| `SAFE_STOP` | Parada preventiva; no se mueve hasta recuperación explícita y validada. |
| `DEGRADED` | Operación limitada por calidad de datos insuficiente (sin geometría fiable). |
| `RECOVERING` | Transición controlada de salida de `SAFE_STOP`/`DEGRADED` hacia `IDLE`. |

### 2.2 Tabla de transiciones permitidas
| Desde \ Evento | mueve+AUTHORIZED | movimiento completado | denegación | datos insuficientes | recover válido | arranque MOVING persistido |
|----------------|------------------|-----------------------|------------|---------------------|----------------|----------------------------|
| `IDLE` | → `MOVING` | — | → `SAFE_STOP` | → `DEGRADED` | — | — |
| `MOVING` | — (`BUSY`) | **completado → `IDLE`** | → `SAFE_STOP` | → `DEGRADED` | — | → `SAFE_STOP` |
| `SAFE_STOP` | **prohibido** | — | `SAFE_STOP` | `SAFE_STOP` | → `RECOVERING` | — |
| `DEGRADED` | **prohibido** | — | → `SAFE_STOP` | `DEGRADED` | → `RECOVERING` | — |
| `RECOVERING` | — | — | → `SAFE_STOP` | → `DEGRADED` | → `IDLE` | — |

> **Movimiento completado (MOVING → IDLE):** en este prototipo el movimiento autorizado se
> completa de forma **inmediata** dentro de la misma solicitud. Por tanto, una solicitud
> autorizada recorre `IDLE → MOVING → IDLE` y el robot queda de nuevo en `IDLE`, listo para el
> siguiente movimiento. El estado `MOVING` es transitorio y se persiste `IDLE` al finalizar.
> La celda `MOVING + mueve = BUSY` solo aplica al caso concurrente (una segunda solicitud
> llega mientras una primera sigue en curso), que en el prototipo síncrono no debería darse.

> **[RC-01] Transiciones persistidas y registradas.** Lo que en esta tabla se describe como
> transitorio se **persiste** dentro de la misma transacción y se **registra** (R9):
> `IDLE → MOVING` (causa `AUTHORIZED`) y `MOVING → IDLE` (`MOVE_COMPLETED`);
> `SAFE_STOP|DEGRADED → RECOVERING` (`RECOVER_REQUESTED`) y `RECOVERING → IDLE`
> (`RECOVER_COMPLETED`). Se añade la transición `IDLE → DEGRADED` por una señal de pérdida de
> posición (`POSITION_QUALITY_LOST`, R3.6) y `MOVING → SAFE_STOP` en el arranque
> (`BOOTSTRAP_MOVING_PERSISTED`). Cada transición es **por robot** (R12).

### 2.3 Transiciones prohibidas (invariantes de seguridad)
- **P-1:** `SAFE_STOP → MOVING` está prohibido. La única salida de `SAFE_STOP` es vía
  `RECOVERING` (recuperación explícita y validada).
- **P-2:** cualquier estado → `MOVING` con **datos no confiables** (positionQuality distinto
  de confiable) está prohibido.

## 3. Orden de evaluación del vigilante

Dada una solicitud de movimiento, el vigilante evalúa en este **orden estricto** y se detiene
en la primera condición que aplique:

1. **Estado del robot.** Si el estado no admite movimiento se rechaza sin evaluar geometría:
   `SAFE_STOP`/`DEGRADED`/`RECOVERING` → `SAFE_STOP_ACTIVE`; un `MOVING` **en curso**
   (solicitud concurrente) → `BUSY`. Como `MOVING` es transitorio y cada solicitud autorizada
   termina en `IDLE`, el estado observado entre solicitudes es `IDLE`, no `MOVING`; por eso un
   movimiento exitoso **no** bloquea al siguiente.
2. **Calidad de posición = `UNRELIABLE`** → denegación `INSUFFICIENT_DATA` (sin geometría).
3. **Calidad de posición = `MISSING`** → denegación `MISSING_POSITION` (sin geometría).
4. **Fallo del repositorio de zonas** → denegación `ZONE_DATA_UNAVAILABLE` (sin geometría).
5. **Origen dentro de una zona** → denegación `ORIGIN_IN_RESTRICTED_ZONE`.
6. **Destino dentro de una zona** → denegación `RESTRICTED_ZONE_VIOLATION`.
7. **Trayectoria cruza una zona** → denegación `TRAJECTORY_CROSSES_ZONE`.
8. Si nada de lo anterior aplica → **`AUTHORIZED`**.

> Las condiciones 2–4 se evalúan **antes** de cualquier geometría (fallo seguro por falta de
> datos). Las condiciones 5–7 usan `isCollision` de la spec 001 y respetan su prioridad
> (origen > destino > trayectoria).

## 4. Consecuencias de la decisión

- **Toda denegación** (condiciones 5–7, y 2–4 por datos) lleva al robot a `SAFE_STOP` (o a
  `DEGRADED` cuando la causa es calidad de datos) **y crea un incidente**.
- Si el robot **ya** está en `SAFE_STOP`/`DEGRADED`/`RECOVERING` o `MOVING` ocupado, la nueva
  solicitud se **rechaza** con `SAFE_STOP_ACTIVE` o `BUSY` (condición 1) sin crear un
  segundo incidente duplicado.
- **Cada evaluación** (autorizada o denegada) se **registra** con su `collisionType` (o la
  causa de datos) y un **snapshot de las zonas** usadas en la decisión.
- La **recuperación** solo ocurre vía `POST /api/robot/recover`, y solo si la posición es
  **segura** (fuera de toda zona) y los **datos son confiables**. *(Sustituido por RC-01: la ruta
  pasa a ser `POST /api/robots/:robotId/recover` y "posición segura" significa fuera de toda zona
  **activa** expandida por el pad r+m de la spec 001; ver R4.)*
- **[RC-01]** Cada incidente identifica el **robot** y la **regla** incumplida (catálogo `RULES` de
  la spec 001) y es consultable (R5.5–R5.8).
- **[RC-01]** Antes de evaluar, la solicitud se valida contra la **sesión** vigente del robot y su
  **secuencia** (R11): una solicitud duplicada o fuera de orden no se evalúa ni crea incidente.

## 5. Aporte de lecturas de posición y reinicio seguro (ADR-10)

### 5.1 Cómo `positionQuality` llega a `RELIABLE`
El robot no puede moverse ni recuperarse con `positionQuality` en `MISSING`/`UNRELIABLE`. Dado
que los sensores reales quedan **reservados para HU-06**, en la línea base se provee una **vía
explícita** para aportar una lectura confiable:

- **`POST /api/robot/position`** con `{ position: {x,y}, quality: 'RELIABLE' }` registra una
  lectura confiable y fija `positionQuality = RELIABLE` y la posición del robot. *(Sustituido por
  RC-01: la ruta es `POST /api/robots/:robotId/position` y una lectura **nunca relocaliza** el
  robot: una lectura `RELIABLE` solo se acepta si coincide con la posición actual — R8.1, R8.4.)*
- El **seed** de la base de datos arranca el robot en una posición válida con
  `positionQuality = RELIABLE`, de modo que la demo pueda mover el robot desde el primer uso.
- Al **arrancar**, el servicio parte con `positionQuality = RELIABLE` y estado `IDLE` (seed),
  de modo que la demo pueda mover el robot desde el primer uso. `positionQuality` solo pasa a
  `MISSING` cuando se recibe una **señal de pérdida explícita** (ADR-10).

> Esta vía es el **sustituto de prototipo** de la telemetría de sensores (HU-06): no simula un
> sensor, solo permite inyectar una lectura confiable de forma explícita y auditable.

### 5.2 Reinicio seguro (ADR-10)
- El servicio **arranca** con `positionQuality = RELIABLE` y estado `IDLE` (seed). No se pone
  `MISSING` por el simple hecho de reiniciar.
- `positionQuality` pasa a `MISSING` **solo** ante una **señal de pérdida de posición
  explícita** (p. ej. `POST /api/robot/position` con `quality = MISSING`/`UNRELIABLE`), y
  entonces se exige una nueva lectura confiable antes de volver a moverse. *(Sustituido por RC-01
  rev3: ruta `POST /api/robots/:robotId/position`; la pérdida lleva a `DEGRADED` y exige además
  `recover`, R3.6 y R4.)*
- Si al arrancar hay un estado `MOVING` persistido, se degrada a `SAFE_STOP` (no se reanuda un
  movimiento a ciegas).

> **Lección PD-09 ("Decidir antes de empezar"):** en una iteración previa el robot quedaba
> detenido sin salida porque no existía forma de aportar una lectura confiable antes de
> recuperar. Esta spec incluye desde el inicio la validación de lecturas y una vía explícita
> para aportarlas, evitando el bloqueo permanente.

## Requirements

### Requirement 1: Evaluación previa contra origen, destino y trayectoria (HU-04)
**User Story:** Como responsable de aseguramiento, quiero que cada movimiento se evalúe antes
de autorizarse contra el origen, el destino y la trayectoria completa, para impedir entradas
a zonas restringidas.

#### Acceptance Criteria
1. WHEN se solicita un movimiento THEN el vigilante SHALL evaluar el origen, el destino y la trayectoria completa usando el modelo geométrico de la spec 001.
2. WHEN el origen está dentro de una zona activa THEN el vigilante SHALL denegar con `ORIGIN_IN_RESTRICTED_ZONE`.
3. WHEN el destino está dentro de una zona activa THEN el vigilante SHALL denegar con `RESTRICTED_ZONE_VIOLATION`.
4. WHEN la trayectoria origen→destino cruza una zona activa y ni el origen ni el destino están dentro de una zona THEN el vigilante SHALL denegar con `TRAJECTORY_CROSSES_ZONE`.
5. WHEN ninguna condición de denegación aplica THEN el vigilante SHALL responder `AUTHORIZED`, actualizar la posición al destino y dejar el robot de nuevo en `IDLE` (el estado `MOVING` es transitorio y se completa en la misma solicitud), de modo que un movimiento exitoso no bloquee al siguiente. **[RC-01 rev4]** (I-7) La respuesta HTTP de `AUTHORIZED` devuelve `state: IDLE` (el estado persistido al terminar la solicitud, DD-209); `MOVING` solo queda en `state_transition_log` (T1/T2).
6. WHEN el vigilante evalúa la geometría THEN el sistema SHALL reutilizar `isCollision` de la spec 001 y NO SHALL recalcular la geometría por su cuenta.
7. IF el origen o el destino están dentro de una zona activa y además la trayectoria cruza otra zona THEN el vigilante SHALL priorizar el chequeo de origen/destino y denegar con `ORIGIN_IN_RESTRICTED_ZONE` o `RESTRICTED_ZONE_VIOLATION` (origen antes que destino, y ambos antes que trayectoria).
8. **[RC-01]** WHEN se solicita un movimiento THEN la solicitud SHALL dirigirse a un robot concreto (`/api/robots/:robotId/move`) y el vigilante SHALL evaluar con el estado, la posición y la calidad de **ese** robot; IF el robot no existe THEN el sistema SHALL responder `404 ROBOT_NOT_FOUND`.
9. **[RC-01]** IF el destino está estrictamente fuera del plano THEN el sistema SHALL responder `422 DESTINATION_OUT_OF_BOUNDS` antes de evaluar, sin cambiar el robot, sin consumir la secuencia y sin registrar una evaluación (comportamiento ya implementado; se hace explícito).

### Requirement 2: Orden de evaluación y prioridad de datos sobre geometría (HU-04)
**User Story:** Como responsable de aseguramiento, quiero un orden de evaluación determinista
que anteponga la calidad de los datos a la geometría, para que la decisión sea predecible y
segura.

#### Acceptance Criteria
1. WHEN el estado del robot no admite movimiento THEN el vigilante SHALL rechazar la solicitud antes de evaluar la geometría, devolviendo `BUSY` si el robot está en `MOVING` (un movimiento en curso) y `SAFE_STOP_ACTIVE` si está en `SAFE_STOP`, `DEGRADED` o `RECOVERING`.
2. IF `positionQuality` es `UNRELIABLE` THEN el vigilante SHALL denegar con `INSUFFICIENT_DATA` sin evaluar la geometría.
3. IF `positionQuality` es `MISSING` THEN el vigilante SHALL denegar con `MISSING_POSITION` sin evaluar la geometría.
4. IF el repositorio de zonas falla THEN el vigilante SHALL denegar con `ZONE_DATA_UNAVAILABLE` sin evaluar la geometría.
5. WHEN varias condiciones podrían aplicar THEN el vigilante SHALL evaluarlas en el orden estricto estado → `UNRELIABLE` → `MISSING` → fallo de repositorio → origen → destino → trayectoria → `AUTHORIZED` y detenerse en la primera que aplique.

### Requirement 3: Parada preventiva por información insuficiente (HU-05)
**User Story:** Como responsable de seguridad, quiero que el robot entre en parada preventiva
ante información insuficiente, para no mover el robot a ciegas.

#### Acceptance Criteria
1. WHEN la causa de denegación es calidad de datos (`INSUFFICIENT_DATA`, `MISSING_POSITION`, `ZONE_DATA_UNAVAILABLE`) THEN el vigilante SHALL llevar el robot a un estado de parada preventiva (`SAFE_STOP` o `DEGRADED`).
2. WHEN la causa de denegación es geométrica THEN el vigilante SHALL llevar el robot a `SAFE_STOP`.
3. IF el robot ya está en `SAFE_STOP`, `DEGRADED`, `RECOVERING` o `MOVING` ocupado WHEN se solicita un movimiento THEN el vigilante SHALL rechazar con `SAFE_STOP_ACTIVE` o `BUSY` y NO SHALL cambiar la posición.
4. WHILE el robot está en `SAFE_STOP` o en `DEGRADED` THEN el sistema SHALL prohibir la transición directa a `MOVING` (transición prohibida P-1); la única salida hacia `MOVING` pasa por `RECOVERING` → `IDLE`.
5. WHEN los datos de posición no son confiables THEN el sistema SHALL prohibir toda transición a `MOVING` (transición prohibida P-2).
6. **[RC-01]** WHEN se recibe una señal de pérdida de posición (`quality` = `MISSING` o `UNRELIABLE`) con el robot en `IDLE` THEN el sistema SHALL llevarlo de inmediato a `DEGRADED` y registrar la transición con la causa `POSITION_QUALITY_LOST` (constitución art. III: ante información insuficiente, parada preventiva). IF el robot ya está en `SAFE_STOP` o `DEGRADED` THEN solo SHALL cambiar la calidad, sin transición. **[RC-01 rev2]** La pérdida en `IDLE` crea además un incidente `R-SIGNAL-01` (R5.11); en parada no crea incidente nuevo.

### Requirement 4: Recuperación explícita y validada (HU-05)
**User Story:** Como responsable de seguridad, quiero que la salida de la parada preventiva
sea explícita y validada, para evitar reanudaciones inseguras.

#### Acceptance Criteria
1. WHEN se solicita `POST /api/robot/recover` con posición segura (fuera de toda zona) y datos confiables THEN el vigilante SHALL transicionar a `RECOVERING` y luego a `IDLE`. *(Sustituido por RC-01 rev3: ruta `POST /api/robots/:robotId/recover`; "posición segura" = fuera de toda zona **activa** expandida por r+m, R4.4.)*
2. IF la posición no es segura o los datos no son confiables WHEN se solicita la recuperación THEN el vigilante SHALL permanecer en el estado de parada y SHALL rechazar la recuperación.
3. WHEN el robot está fuera de `SAFE_STOP`/`DEGRADED` THEN una solicitud de recuperación SHALL ser idempotente o rechazada sin efectos secundarios. *(Sustituido por RC-01 por R4.5.)*
4. **[RC-01]** IF la recuperación se rechaza THEN el sistema SHALL responder `409 RECOVERY_NOT_ALLOWED` con un campo `cause`, evaluado en este orden: `UNRELIABLE_DATA` (`positionQuality` distinto de `RELIABLE`), `ZONE_DATA_UNAVAILABLE` (no se pueden leer las zonas, por lo que la seguridad de la posición no es verificable) y `UNSAFE_POSITION` (la posición está dentro de una zona **activa** expandida por el pad r+m). No SHALL cambiar estado ni posición y SHALL auditar el rechazo. **[RC-01 rev2]** La auditoría persiste aunque la respuesta sea 409 (R5.10).
5. **[RC-01]** WHEN el robot está en `IDLE` THEN `recover` SHALL ser idempotente: `200` con `transitioned: false`, sin transición, auditado como `RECOVER_NOOP`. WHEN la recuperación tiene éxito THEN SHALL responder `200` con `transitioned: true`.
6. **[RC-01]** WHEN se recupera un robot THEN el registro de la transición `RECOVERING → IDLE` SHALL incluir el snapshot de las zonas activas usadas para decidir que la posición era segura (traza de liberaciones obtenidas desactivando una zona).

### Requirement 5: Registro de evaluaciones e incidentes (HU-04, HU-05)
**User Story:** Como responsable de seguridad, quiero que cada evaluación y cada denegación
queden registradas, para mantener la trazabilidad.

#### Acceptance Criteria
1. WHEN el vigilante evalúa un movimiento THEN el sistema SHALL registrar la evaluación con su `collisionType` (o causa de datos) y un snapshot de las zonas usadas en la decisión.
2. WHEN una evaluación termina en denegación que lleva a parada THEN el sistema SHALL crear un incidente asociado a esa decisión.
3. IF una nueva solicitud se rechaza por estado (`SAFE_STOP_ACTIVE`/`BUSY`) THEN el sistema NO SHALL crear un incidente por ese rechazo, pero SHALL registrar el rechazo en un log de auditoría (registro distinto de los incidentes) para fines de trazabilidad.
4. WHEN se crea un incidente THEN el registro SHALL ser inmutable (solo inserción).
5. **[RC-01]** WHEN se crea un incidente THEN SHALL guardar el `robot_id` del robot implicado y la `rule` incumplida según el catálogo `RULES` de la spec 001: `R-ZONA-01` para `ORIGIN_IN_RESTRICTED_ZONE`, `RESTRICTED_ZONE_VIOLATION` y `TRAJECTORY_CROSSES_ZONE`; `R-SIGNAL-01` para `INSUFFICIENT_DATA` y `MISSING_POSITION`; `R-DATA-01` para `ZONE_DATA_UNAVAILABLE`. **[RC-01 rev2]** La regla se obtiene con `ruleForDecision` del catálogo de la spec 001 (única definición). El incidente SHALL guardar también `zone_name` (zona implicada en la denegación geométrica; `NULL` en causas de datos), sin deducirla del snapshot.
6. **[RC-01]** WHEN se solicita `GET /api/incidents` (opcionalmente `?robotId=`) THEN el sistema SHALL responder `200` con los incidentes del más reciente al más antiguo, cada uno con `id`, `robotId`, `robotName`, `rule`, `zoneName`, `decisionCode`, `collisionType`, `stateAfter`, `origin`, `destination`, `reason` y `createdAt` (ISO-8601). IF `robotId` no existe THEN `404 ROBOT_NOT_FOUND`.
7. **[RC-01]** WHEN se solicita `GET /api/incidents/:id` THEN el sistema SHALL responder `200` con los campos anteriores más `zonesSnapshot`; IF no existe THEN `404 INCIDENT_NOT_FOUND`.
8. **[RC-01]** IF una solicitud se rechaza por estado, por sesión inválida (`INVALID_SESSION`) o por secuencia duplicada o fuera de orden (`DUPLICATE_EVENT`) THEN el sistema NO SHALL crear un incidente (no se duplican incidentes por el mismo evento) y SHALL registrar el rechazo en el log de auditoría.
9. **[RC-01]** WHEN se registra una evaluación, un rechazo, una lectura de posición, una sesión o una transición THEN el registro SHALL ser inmutable (la base rechaza `UPDATE` y `DELETE`).
10. **[RC-01 rev2]** WHEN una operación termina en un rechazo auditado (`INVALID_SESSION`, `DUPLICATE_EVENT`, `SAFE_STOP_ACTIVE`, `BUSY`, `RECOVERY_NOT_ALLOWED`, `POSITION_CONFLICT`, `ROBOT_START_IN_RESTRICTED_ZONE`) THEN la fila de `audit_log` SHALL quedar confirmada en la base aunque la respuesta HTTP sea `409`: el rechazo es un resultado del servicio, no una excepción que revierta la transacción. **[RC-01 rev3]** El rechazo del alta (`ROBOT_START_IN_RESTRICTED_ZONE`) se audita aunque el robot no exista: `robot_id` y `state` nulos, `x`/`y` = posición de inicio y `detail = { name, type }` (N-3). **[RC-01 rev4]** Lo mismo para `ROBOT_START_NOT_VERIFIABLE` (alta con zonas no legibles), con `cause` en `detail`. Las filas de `audit_log` anteriores a la 011 se conservan intactas con `robot_id` nulo (B-1); la obligatoriedad de `robot_id`/`state` en las filas nuevas la impone un trigger, no un CHECK de tabla.
11. **[RC-01 rev2]** WHEN una señal de pérdida (`UNRELIABLE`/`MISSING`) lleva el robot de `IDLE` a `DEGRADED` (T5) THEN el sistema SHALL crear un incidente con `rule = R-SIGNAL-01`, `decision_code = POSITION_QUALITY_LOST`, `state_after = DEGRADED`, origen = destino = posición actual y `zone_name` nulo (botón "Perder conexión" de la spec 003; sustituye a DD-217 "sin incidente"). Si el robot ya estaba en parada, NO SHALL crearse un incidente nuevo.

### Requirement 6: Reinicio seguro (ADR-10)
**User Story:** Como responsable de seguridad, quiero que el arranque del servicio sea seguro,
para no reanudar movimientos tras un reinicio.

#### Acceptance Criteria
1. WHEN el servicio arranca THEN el sistema SHALL iniciar con `positionQuality = RELIABLE` y estado `IDLE` (seed), de modo que la demo pueda mover el robot desde el primer uso.
2. IF se recibe una señal de pérdida de posición explícita (`POST /api/robot/position` con `quality` igual a `MISSING` o `UNRELIABLE`) THEN el sistema SHALL poner `positionQuality` en ese valor y exigir una nueva lectura confiable antes de volver a moverse. *(Sustituido por RC-01 rev2: ruta `POST /api/robots/:robotId/position`; además lleva a `DEGRADED` y crea incidente, R3.6 y R5.11.)*
3. IF al arrancar existe un estado `MOVING` persistido THEN el sistema SHALL transicionar el robot a `SAFE_STOP` y NO SHALL reanudar el movimiento.
4. WHEN el servicio arranca de forma normal (sin señal de pérdida) THEN el sistema NO SHALL poner `positionQuality` en `MISSING` por el solo hecho de reiniciar.
5. **[RC-01]** WHEN el servicio arranca THEN el reinicio seguro SHALL aplicarse a **cada** robot (R6.3 por robot) y cada degradación `MOVING → SAFE_STOP` SHALL registrarse con la causa `BOOTSTRAP_MOVING_PERSISTED`. Sobre una base existente se conservan estado y calidad persistidos de cada robot.

### Requirement 7: Contrato, robustez y verificabilidad (RNF)
**User Story:** Como desarrollador, quiero un contrato validado y una decisión verificable
sin infraestructura, para probar el vigilante de forma aislada.

#### Acceptance Criteria
1. WHEN se recibe una solicitud THEN el sistema SHALL validar la entrada con Zod antes de procesarla.
2. WHEN ocurre un error THEN el sistema SHALL responder con formato `{ code, message }` y NO SHALL exponer trazas de pila.
3. WHEN se evalúa la decisión del vigilante THEN la lógica SHALL ser pura y determinista (misma entrada → misma decisión) y ejecutable sin frontend ni base de datos real.
4. WHEN se define la prueba T-12 THEN el sistema SHALL contar con los 28 escenarios (A..G) definidos y ejecutables sin frontend ni base de datos real; para considerar cumplido este criterio basta con que estén definidos y sean ejecutables, sin exigir una corrida real registrada.

### Requirement 8: Aporte explícito de lectura de posición (HU-05, ADR-10)
**User Story:** Como responsable de seguridad, quiero una vía explícita para aportar una
lectura de posición confiable, para que el robot pueda moverse y recuperarse sin depender de
los sensores reservados para HU-06.

#### Acceptance Criteria
1. WHEN se solicita `POST /api/robot/position` con una posición válida y `quality = RELIABLE` THEN el sistema SHALL fijar la posición del robot y `positionQuality = RELIABLE`. *(Sustituido por RC-01 por R8.5: una lectura nunca relocaliza el robot.)*
2. IF el payload de posición es inválido o `quality` no es un valor admitido THEN el sistema SHALL rechazar con `422` y NO SHALL cambiar la posición ni la calidad.
3. WHEN `positionQuality` pasa a `RELIABLE` y el robot está en `IDLE` THEN un movimiento posterior SHALL poder evaluarse por geometría (ya no se deniega por datos).
4. WHEN se aporta una lectura de posición THEN el sistema NO SHALL simular un sensor real; la vía es un sustituto de prototipo, explícito y auditable, de la telemetría reservada para HU-06.
5. **[RC-01]** WHEN se aporta una lectura con `quality = RELIABLE` THEN el sistema SHALL aceptarla solo si `position` coincide exactamente con la posición actual del robot: entonces fija `positionQuality = RELIABLE` sin cambiar la posición. IF no coincide THEN SHALL responder `409 POSITION_CONFLICT`, sin cambios, y auditar la posición y calidad previas y las recibidas. IF la posición `RELIABLE` está fuera del plano THEN `422 POSITION_OUT_OF_BOUNDS`. (Evita "teletransportar" el robot fuera de una zona para liberarlo sin moverlo.)
6. **[RC-01]** WHEN se aporta una lectura con `quality` = `UNRELIABLE` o `MISSING` (señal de pérdida) THEN el sistema SHALL aceptarla siempre que `quality` sea válida: ignora la posición recibida (no la valida contra el plano; solo la audita si es un punto válido), fija la calidad y aplica R3.6 y **[RC-01 rev2]** R5.11.
7. **[RC-01]** WHEN se aporta cualquier lectura THEN el sistema SHALL registrarla en el log de auditoría (`POSITION_READING` o `POSITION_CONFLICT`) con el robot, la calidad y la posición recibidas.

### Requirement 9 [RC-01]: Registro de toda transición de estado (constitución art. IV)
**User Story:** Como responsable de seguridad, quiero que cada cambio de estado de cada robot
quede registrado con su causa, para reconstruir cómo llegó a cada estado, en particular cómo
salió de la parada segura.

#### Acceptance Criteria
1. WHEN el estado persistido de un robot cambia, incluidos los estados transitorios `MOVING` y `RECOVERING`, THEN el sistema SHALL insertar en `state_transition_log` una fila con `robot_id`, estado previo, estado nuevo, causa, `detail` (JSON opcional) y fecha, en la **misma transacción** que el cambio.
2. WHEN un movimiento se autoriza THEN SHALL registrarse `IDLE → MOVING` (`AUTHORIZED`, con `detail` = destino, sesión y secuencia) y `MOVING → IDLE` (`MOVE_COMPLETED`).
3. WHEN una denegación lleva a parada THEN SHALL registrarse la transición con el código de la decisión como causa (p. ej. `IDLE → SAFE_STOP`, `TRAJECTORY_CROSSES_ZONE`) y el `incidentId` en `detail`.
4. WHEN una recuperación tiene éxito THEN SHALL registrarse `SAFE_STOP|DEGRADED → RECOVERING` (`RECOVER_REQUESTED`) y `RECOVERING → IDLE` (`RECOVER_COMPLETED`, con el snapshot de zonas; R4.6).
5. WHEN se registra un robot (spec 003) THEN su estado inicial SHALL registrarse como transición con estado previo nulo y causa `ROBOT_REGISTERED`. **[RC-01 rev3]** Solo aplica a los robots dados de alta por la API: los de la semilla (A1 y V2) se crean en la migración 008 y quedan registrados con la fila base `MIGRATION_BASELINE` (R9.8), no con T9 (N-17).
6. IF una operación no cambia el estado (rechazo por estado o por sesión/secuencia, `recover` en `IDLE`, lectura sin efecto de estado) THEN NO SHALL registrarse una transición; queda en el log de auditoría.
7. WHEN se reproduce `state_transition_log` de un robot THEN la secuencia de estados SHALL coincidir exactamente con la secuencia de estados persistidos de ese robot.
8. **[RC-01 rev2]** WHEN se crea `state_transition_log` (migración 010) THEN la propia migración SHALL insertar una fila base por cada robot existente con `from_state = NULL`, `to_state` = su estado persistido y `cause = MIGRATION_BASELINE`. Es un evento real (la creación del registro), no un registro fabricado (art. XV); así R9.7 se cumple también para los robots anteriores al registro.

### Requirement 10 [RC-01]: Vigilante único (constitución art. III)
**User Story:** Como responsable de seguridad, quiero que exista un único componente que decida
y cambie el estado de los robots, para que ninguna vía lo esquive.

#### Acceptance Criteria
1. WHEN se integra esta spec con la UI de la spec 003 THEN el sistema SHALL exponer como únicas vías de cambio de estado `POST /api/robots/:robotId/move`, `/recover`, `/position` y el arranque (`db/bootstrap.ts`).
2. WHEN se completa el refuerzo THEN `/api/simulation/*` (incluido `POST /api/simulation/reset`) y `/api/robot/*` (singular) SHALL responder `404 NOT_FOUND`.
3. WHEN se analiza el código del backend THEN solo `guardianService` y `db/bootstrap.ts` SHALL escribir en `robot_state` (verificado con una prueba de arquitectura).
4. WHEN se entrega la retirada de `/api/simulation/*` THEN SHALL entregarse en la misma integración que la migración de la UI de la spec 003; nunca se integra una versión con dos vigilantes activos ni con una UI que llame a rutas retiradas.
5. **[RC-01 rev2]** Las migraciones SQL (`packages/backend/migrations/*.sql`) son escritoras autorizadas **solo durante el despliegue del esquema**. **[RC-01 rev3]** (N-16): la 008 escribe `robot_state` (copia la fila actual como A1 y crea V2); la 010 escribe la fila base en `state_transition_log` (no en `robot_state`). Ningún otro código de `src/` escribe `robot_state` salvo `guardianService` y `db/bootstrap.ts`.
6. **[RC-01 rev2]** WHEN se entrega el refuerzo THEN ninguna integración (`integration`/`develop`) SHALL contener a la vez el vigilante provisional (`/api/simulation/*`) y cambios de estado de esta spec (señal de pérdida, `DEGRADED`, estado por robot): todo se integra en la unidad U1.
7. **[RC-01 rev5]** (decisión 2, N4-4) WHEN se completa el refuerzo THEN `guardianService` y el controller de `/api/robot/*` SHALL no contener `moveLegacy` (vía temporal sin sesión, ver la nota de R11); se verifica en la prueba de arquitectura. **[RC-01 rev6]** (N5-2) Solo `robotController.test.ts`, `robot.api.test.ts` y una `moveLegacy.test.ts` dedicada pueden referenciar `moveLegacy`; RC-20 retira esa prueba y los handlers legacy de `controllers/robotController.ts` (el archivo sirve a las rutas antiguas y a las por robot y persiste solo con los handlers por robot), y la prueba de arquitectura comprueba que ninguna prueba restante lo referencia.

### Requirement 11 [RC-01]: Sesión y secuencia de las solicitudes de movimiento (HU-03 del prototipo)
**User Story:** Como operador, quiero que cada solicitud de movimiento identifique robot, sesión y
secuencia y que las duplicadas o fuera de orden se rechacen, para que un reintento no mueva ni
detenga dos veces al robot.

#### Acceptance Criteria
1. WHEN se solicita `POST /api/robots/:robotId/sessions` THEN el sistema SHALL crear una sesión con un `sessionId` (UUID generado en el backend), responder `201 { sessionId }`, invalidar la sesión anterior de ese robot y auditar `SESSION_STARTED`.
2. WHEN se solicita `POST /api/robots/:robotId/move` THEN el cuerpo SHALL ser `{ destination, sessionId, sequence }` con `sequence` entero ≥ 1; un cuerpo sin esos campos SHALL rechazarse con `422 INVALID_DESTINATION`. *(Sustituido por RC-01 rev2: `422 INVALID_MOVE_REQUEST`; el cuerpo es `MoveCommand`/`moveCommandSchema`, definidos por la spec 003.)*
3. IF `sessionId` no es la sesión vigente del robot THEN el sistema SHALL responder `409 INVALID_SESSION` sin evaluar, sin cambiar el estado y auditando el rechazo.
4. IF `sequence` es menor o igual que la última secuencia aceptada en esa sesión THEN el sistema SHALL responder `409 DUPLICATE_EVENT` sin evaluar, sin cambiar el estado, sin crear incidente y auditando el rechazo.
5. WHEN se valida una solicitud THEN el orden SHALL ser: Zod (`422`) → robot existe (`404`) → límites del plano (`422 DESTINATION_OUT_OF_BOUNDS`) → sesión (`409 INVALID_SESSION`) → secuencia (`409 DUPLICATE_EVENT`) → vigilante (R2.5). Una solicitud que supera la comprobación de secuencia **consume** su número de secuencia, cualquiera que sea la decisión del vigilante.
6. WHEN se acepta una solicitud THEN el sistema SHALL persistir por robot la última solicitud aceptada (sesión, secuencia, destino y fecha) y exponerla en `GET /api/robots/:robotId/state` como `lastRequest` (tipo `LastRequest` de la spec 003; la tabla `robot_sessions` y `sessionService.startSession` también son de la 003). **[RC-01 rev2]** `lastRequest.sequence` es el dato de "solicitudes procesadas" que muestra la UI. **[RC-01 rev3]** (N-4) La validación de sesión y secuencia, su auditoría y el registro de la última solicitud aceptada los hace **una sola** operación de la spec 003, `sessionService.acceptRequest(robotId, cmd): ServiceResult<LastRequest>`, que el `move` invoca antes del vigilante; esta spec **no escribe** `robot_sessions`. **[RC-01 rev4]** La firma es `acceptRequest(robotId, cmd, currentState)`: el `move` le pasa el estado del robot que ya leyó, para auditar (I-3). `GET /api/robots/:robotId/state` obtiene `lastRequest` con `sessionService.getLastRequest(robotId): LastRequest | null` (spec 003, I-4).

> **[RC-01 rev5] Desvío temporal declarado de R11 (decisión 2, N4-4).** Mientras conviven en la rama de
> trabajo el vigilante por robot y el antiguo `/api/robot/*` (desde RC-16 hasta RC-20), el controller
> antiguo de `/api/robot/move` llama a `guardianService.moveLegacy(robotId = 1, destination)`, que evalúa
> con el mismo vigilante pero **no** exige `sessionId` ni `sequence`. No contradice R11 en el producto:
> es una vía sin montar en ninguna integración (U1 se integra entera, R10.6), `POST
> /api/robots/:robotId/move` sigue exigiendo sesión (R11.2–R11.5) y `moveLegacy` se retira en RC-20 (R10.7).
> **[RC-01 rev6]** (N5-2) Para que RC-20 no deje pruebas rotas, `guardianService.test.ts`,
> `guardianService.requirements.test.ts` y `liveness.test.ts` se adaptan a `MoveCommand` y **no** llaman a
> `moveLegacy`: solo `robotController.test.ts`, `robot.api.test.ts` y `moveLegacy.test.ts` pueden hacerlo.

### Requirement 12 [RC-01]: Estado por robot
**User Story:** Como operador, quiero supervisar varios robots, cada uno con su propio estado,
para reproducir los escenarios del prototipo con la aspiradora y el vigilante.

#### Acceptance Criteria
1. WHEN existen varios robots (catálogo de la spec 003) THEN cada uno SHALL tener su propia fila en `robot_state` (estado, posición, `positionQuality`) y el vigilante SHALL decidir con la fila del robot indicado.
2. WHEN se registra un robot (spec 003) THEN su estado inicial SHALL crearlo `guardianService` (no el cliente): `IDLE`, `positionQuality = RELIABLE` y posición de inicio (120, 90), con la transición `ROBOT_REGISTERED` (R9.5). **[RC-01 rev2]** `initRobot` crea la fila con un `INSERT` simple y falla si ya existe (nunca reinicia un robot existente). IF la posición inicial cae dentro de una zona **activa** expandida por r+m THEN el alta SHALL rechazarse con `409 ROBOT_START_IN_RESTRICTED_ZONE`, sin crear nada y auditando el rechazo. **[RC-01 rev3]** (N-2) Esa comprobación es una decisión de seguridad y la hace el vigilante: regla pura `evaluateStartPosition` y `guardianService.checkStartPosition(position): ServiceResult<void>`, que audita el rechazo; el catálogo de la spec 003 la invoca **antes** de insertar en `robots`. Después, en la misma transacción, `initRobot(robotId, position)` **solo** inserta el estado y registra T9; si por defensa detecta una posición insegura, lanza una excepción y la transacción se revierte. La posición la decide quien da de alta (robots nuevos: (120, 90)). **[RC-01 rev4]** IF las zonas no se pueden leer al validar la posición THEN el alta SHALL rechazarse con `409 ROBOT_START_NOT_VERIFIABLE` y `cause: ZONE_DATA_UNAVAILABLE` (en la respuesta y en la auditoría), sin crear nada; `ROBOT_START_IN_RESTRICTED_ZONE` queda solo para una posición comprobada dentro de una zona activa. Decisión humana del 2026-11-23 (art. XIII). `initRobot` devuelve `void` (M-6).
3. WHEN se solicita `GET /api/robots/:robotId/state` THEN el sistema SHALL responder `200` con `robotId`, `state`, `position`, `positionQuality` y `lastRequest`; IF el robot no existe THEN `404 ROBOT_NOT_FOUND`.
4. WHEN cambia el estado de un robot THEN el estado de los demás robots NO SHALL cambiar. Los robots no colisionan entre sí (fuera de alcance).
5. WHEN se migran los datos existentes THEN la fila única actual de `robot_state` SHALL pasar a ser el estado del robot "Aspiradora A1", conservando estado, posición y calidad; el robot "Vigilante V2" SHALL recibir su estado inicial en (488, 290). Los registros append-only existentes NO SHALL reescribirse. ~~**[RC-01 rev2]** En una base **nueva**, A1 queda en (160, 123) y V2 en (488, 290) (prototipo); en una base **existente**, A1 conserva la posición de la fila actual.~~ *(Sustituido por RC-01 rev3, Q-I: la migración ya aplicada `002` siempre crea la fila en (120, 90), así que la 008 no puede distinguir una base nueva de una existente.)* **[RC-01 rev3]** A1 empieza **siempre** en la posición de la fila actual — (120, 90) en toda base nueva — y V2 en (488, 290). La 008 copia la fila `id = 1` tal cual como A1 y crea la de V2, sin lógica de detección ni `UPDATE`.

## 6. Contrato de API

Base: `/api/robot` e `/api/incidents` *(Sustituido por RC-01 rev2: base `/api/robots/:robotId` e `/api/incidents`.)*

### Endpoints
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/robot/state` | Estado, posición y `positionQuality` actuales |
| `POST` | `/api/robot/move` | Evaluar y (si procede) autorizar un movimiento |
| `POST` | `/api/robot/position` | Aportar una lectura de posición confiable (fija `positionQuality`) |
| `POST` | `/api/robot/recover` | Recuperación explícita y validada |
| `GET` | `/api/incidents` | Listar incidentes registrados |

> **Sustituido por RC-01.** Las rutas `/api/robot/*` (singular) se retiran y pasan a ser por robot.
> Contrato vigente:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/robots/:robotId/state` | **[RC-01]** Estado, posición, `positionQuality` y `lastRequest` del robot |
| `POST` | `/api/robots/:robotId/sessions` | **[RC-01]** Nueva sesión → `201 { sessionId }` |
| `POST` | `/api/robots/:robotId/move` | **[RC-01]** `{ destination, sessionId, sequence }` → decisión |
| `POST` | `/api/robots/:robotId/recover` | **[RC-01]** Recuperación validada → `{ ...estado, transitioned }` |
| `POST` | `/api/robots/:robotId/position` | **[RC-01]** Lectura de posición (no relocaliza) |
| `GET` | `/api/incidents?robotId=` | **[RC-01]** Incidentes con robot y regla, del más reciente al más antiguo |
| `GET` | `/api/incidents/:id` | **[RC-01]** Detalle con `zonesSnapshot` |
| `GET` / `POST` | `/api/robots`, `GET /api/robots/:robotId` | Catálogo de robots: **lo define la spec 003** |
| — | `/api/simulation/*`, `/api/robot/*` | **[RC-01] Retiradas** → `404 NOT_FOUND` |

#### `POST /api/robot/move`
Request:
```json
{ "destination": { "x": 250.0, "y": 175.0 } }
```
Respuesta `AUTHORIZED` (200):
```json
{ "decision": "AUTHORIZED", "state": "MOVING", "position": { "x": 250.0, "y": 175.0 } }
```
*(Sustituido por RC-01 rev4, I-7: la respuesta de `AUTHORIZED` devuelve `"state": "IDLE"`, como lo
implementado y DD-209.)*

#### `POST /api/robot/position`
Request:
```json
{ "position": { "x": 120.0, "y": 90.0 }, "quality": "RELIABLE" }
```
Respuesta (200):
```json
{ "state": "IDLE", "position": { "x": 120.0, "y": 90.0 }, "positionQuality": "RELIABLE" }
```
> Tras un reinicio (`positionQuality = MISSING`), esta llamada restablece una lectura
> confiable para poder mover/recuperar. El seed ya la deja en `RELIABLE` para la demo.
Respuesta de denegación geométrica (200, decisión en cuerpo):
```json
{
  "decision": "DENIED",
  "state": "SAFE_STOP",
  "position": { "x": 120.0, "y": 90.0 },
  "collisionType": "TRAJECTORY_CROSSES_ZONE",
  "incidentId": 42,
  "reason": "Trajectory crosses restricted zone"
}
```
Rechazo por estado (409):
```json
{ "decision": "REJECTED", "code": "SAFE_STOP_ACTIVE", "state": "SAFE_STOP" }
```

#### [RC-01] `POST /api/robots/:robotId/move`
Request:
```json
{ "destination": { "x": 250.0, "y": 175.0 }, "sessionId": "3f9c…", "sequence": 7 }
```
Las respuestas `AUTHORIZED`/`DENIED` (200) y `REJECTED` (409) añaden `robotId` y
`positionQuality`; `DENIED` añade además `rule` y `zoneName`. **[RC-01 rev2]** Body `MoveCommand`
(spec 003); un body inválido → `422 INVALID_MOVE_REQUEST`. Rechazos previos al vigilante:
```json
{ "code": "DUPLICATE_EVENT", "message": "Sequence 7 was already processed for this session" }
```

#### [RC-01] `POST /api/robots/:robotId/recover`
- `200` → `{ "robotId": 1, "state": "IDLE", "position": { … }, "positionQuality": "RELIABLE", "transitioned": true }`
  (`transitioned: false` si el robot ya estaba en `IDLE`).
- `409` → `{ "code": "RECOVERY_NOT_ALLOWED", "cause": "UNSAFE_POSITION", "message": "…" }`

#### [RC-01] `GET /api/incidents`
```json
[
  {
    "id": 42, "robotId": 1, "robotName": "Aspiradora A1", "rule": "R-ZONA-01",
    "zoneName": "Escaleras", "decisionCode": "TRAJECTORY_CROSSES_ZONE",
    "collisionType": "TRAJECTORY_CROSSES_ZONE", "stateAfter": "SAFE_STOP",
    "origin": { "x": 120, "y": 90 }, "destination": { "x": 110, "y": 600 },
    "reason": "Trajectory crosses restricted zone: Escaleras",
    "createdAt": "2026-11-22T21:30:00.000Z"
  }
]
```
Los incidentes anteriores al refuerzo (sin `robot_id`) se devuelven con `robotId: null` y
`robotName: null`; su `rule` se deriva del `decisionCode` al leer (no se reescriben).

### Catálogo de códigos de decisión / error
| Categoría | Código | Significado |
|-----------|--------|-------------|
| Autorización | `AUTHORIZED` | Movimiento permitido |
| Denegación geométrica | `ORIGIN_IN_RESTRICTED_ZONE` | Origen dentro de zona |
| Denegación geométrica | `RESTRICTED_ZONE_VIOLATION` | Destino dentro de zona |
| Denegación geométrica | `TRAJECTORY_CROSSES_ZONE` | Trayectoria cruza zona |
| Denegación por datos | `INSUFFICIENT_DATA` | `positionQuality = UNRELIABLE` |
| Denegación por datos | `MISSING_POSITION` | `positionQuality = MISSING` |
| Denegación por datos | `ZONE_DATA_UNAVAILABLE` | Repositorio de zonas caído |
| Rechazo por estado | `SAFE_STOP_ACTIVE` | Movimiento pedido en parada preventiva |
| Rechazo por estado | `BUSY` | Movimiento pedido durante `MOVING`/`RECOVERING` *(Sustituido por RC-01 rev2: solo un `MOVING` concurrente; `RECOVERING` → `SAFE_STOP_ACTIVE`, R2.1)* |
| **[RC-01]** Rechazo previo | `INVALID_SESSION` | La sesión no es la vigente del robot (409) |
| **[RC-01]** Rechazo previo | `DUPLICATE_EVENT` | Secuencia duplicada o fuera de orden (409) |
| **[RC-01]** Recuperación | `RECOVERY_NOT_ALLOWED` | `recover` rechazado; `cause`: `UNRELIABLE_DATA` \| `ZONE_DATA_UNAVAILABLE` \| `UNSAFE_POSITION` (409) |
| **[RC-01]** Lectura | `POSITION_CONFLICT` | Lectura `RELIABLE` que no coincide con la posición actual (409) |
| **[RC-01]** No encontrado | `ROBOT_NOT_FOUND` / `INCIDENT_NOT_FOUND` | Recurso inexistente (404) |
| **[RC-01]** Validación | `DESTINATION_OUT_OF_BOUNDS` / `POSITION_OUT_OF_BOUNDS` | Fuera del plano (422) |
| **[RC-01]** Validación | `INVALID_DESTINATION` / `INVALID_POSITION` | Payload inválido (422) *(Sustituido por RC-01 rev3 en `move`: `INVALID_MOVE_REQUEST`; `INVALID_POSITION` sigue vigente en `position`)* |
| **[RC-01]** Causa de transición | `POSITION_QUALITY_LOST` | Señal de pérdida en `IDLE` → `DEGRADED` |
| **[RC-01 rev2]** Validación | `INVALID_MOVE_REQUEST` | Cuerpo de `move` inválido (sin `destination`, `sessionId` o `sequence`) (422) |
| **[spec 006]** Validación | `INVALID_SEVERITY_FILTER` | `severity` de `GET /api/incidents` fuera de `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` (422); los incidentes ganan el campo `severity` derivado del `decisionCode` |
| **[RC-01 rev2]** Alta | `ROBOT_START_IN_RESTRICTED_ZONE` | Posición inicial dentro de una zona activa (409) |
| **[RC-01 rev4]** Alta | `ROBOT_START_NOT_VERIFIABLE` | No se pueden leer las zonas para validar la posición inicial; `cause: ZONE_DATA_UNAVAILABLE` (409). Decisión humana (art. XIII) |
| **[RC-01 rev2]** Incidente | `POSITION_QUALITY_LOST` (`decision_code`) | Pérdida de señal en `IDLE`, regla `R-SIGNAL-01` |
| **[RC-01 rev2]** Causa de transición | `MIGRATION_BASELINE` | Fila base por robot al crear `state_transition_log` |

## 7. Prueba T-12 — 28 escenarios

Ejecutables **sin frontend ni base de datos real** (regla pura + dobles de repositorio).

| Grupo | Nº | Enfoque |
|-------|----|---------|
| **A** | 9 | Destino (dentro/fuera/borde de zona) → `RESTRICTED_ZONE_VIOLATION` / `AUTHORIZED` |
| **B** | 5 | Trayectoria (cruza/tangente/no cruza) → `TRAJECTORY_CROSSES_ZONE` / `AUTHORIZED` |
| **C** | 3 | Sin zonas activas → siempre `AUTHORIZED` |
| **D** | 5 | Radio del robot `r = 10` (expansión por radio) |
| **E** | 3 | Margen de seguridad `m = 5` (expansión por margen) |
| **F** | 2 | Calidad de datos → `INSUFFICIENT_DATA` (`UNRELIABLE`) y `MISSING_POSITION` (`MISSING`) |
| **G** | 1 | Repositorio de zonas caído → `ZONE_DATA_UNAVAILABLE` |

Total: 9 + 5 + 3 + 5 + 3 + 2 + 1 = **28**.

## Glossary

| Término | Definición |
|---------|------------|
| Vigilante | Componente del backend que decide si un movimiento es seguro; independiente de la UI. |
| positionQuality | Calidad de la posición del robot: confiable, `UNRELIABLE` o `MISSING`. |
| Parada preventiva | Negativa a moverse ante colisión o datos insuficientes. |
| SAFE_STOP / DEGRADED | Estados de parada: por geometría/estado vs por calidad de datos. |
| RECOVERING | Estado transitorio de salida controlada hacia `IDLE`. |
| Incidente | Registro inmutable de una denegación/parada, con causa y snapshot de zonas. |
| CollisionType | Causa geométrica reportada por `isCollision` (spec 001). |
| ADR-10 | Decisión de arquitectura de reinicio seguro. |
| T-12 | Suite de 28 escenarios que verifica la decisión sin frontend ni BD real. |

## 8. Fuera de alcance

- Interfaz de usuario del vigilante (la consume la spec 003).
- Inyección de fallos de sensor como funcionalidad de demo (reservada en spec 003).
- Trayectorias curvas y formas de zona no rectangulares (fuera de spec 001).
- Autenticación y autorización. ~~**[RC-01]** Ver pregunta abierta Q-A.~~ *(Sustituido por RC-01 rev4, M-1: Q-A resuelta como riesgo aceptado, §12b.)*
- **[RC-01]** Colisiones entre robots: cada robot se evalúa solo contra las zonas (limitación conocida).
- **[RC-01]** Inyección de fallos de demo desde la UI (botón "Perder conexión"): ver Q-B. La señal de
  pérdida por API (R8.6) sí está en alcance.
  **[RC-01 rev2] Resuelto (Q-B):** el botón "Perder conexión" de la spec 003 envía la señal de
  pérdida (`MISSING`) y sale de lo reservado; la inyección de fallos de **sensor** sigue reservada.

## 9. Dependencias

- **spec `001-restricted-zones`**: modelo geométrico, `Zone`, `isCollision`, `CollisionType`.
- **spec `003-movement-simulation`**: consume el vigilante desde la UI (muestra la decisión).
- **[RC-01] spec 001**: define el catálogo de reglas `RULES` (`R-ZONA-01`, `R-SIGNAL-01`,
  `R-DATA-01`) que se guarda en cada incidente.
- **[RC-01] spec 003**: define el catálogo de robots (tabla `robots`, `GET/POST /api/robots`), el
  botón "Nueva sesión", el panel de telemetría y la vista "Incidentes", que consumen esta API. Su
  vigilante provisional (`/api/simulation/*`) se retira por R10.

## 10. Trazabilidad

```
HU-04, HU-05
  → requirements.md (este documento)
    → design.md
      → tasks.md
        → código (backend/rules watchman, state machine, incidents)
          → pruebas (T-12 28 escenarios, integración /api/robot, /api/incidents)
            [RC-01 rev3] integración /api/robots/:robotId/*, /api/incidents; arquitectura; E2E (spec 003)
            → evidencia (CI verde + demo)
```

## 11. Compuerta Fase 1 (ENTENDER)

- [x] El humano aprueba explícitamente este `requirements.md` antes de pasar a DISEÑAR. **[RC-01 rev3]** Aprobado en lo implementado (773823a) el 2026-11-23 (Q-C).
- [ ] **[RC-01 rev3]** El humano aprueba el refuerzo RC-01 (rev2 + rev3).
- [ ] **[RC-01 rev4]** El humano aprueba la revisión 4 (decisiones del 2026-11-23 ya tomadas; falta la aprobación del documento).
- [ ] **[RC-01 rev5]** El humano aprueba la revisión 5 (decisiones del 2026-11-23 ya tomadas; falta la aprobación del documento).

## 12. Preguntas abiertas [RC-01] — **resueltas en RC-01 rev2 (2026-11-23)**

> Decisiones del humano: Q-A deuda documentada (ver §12b); Q-B botón habilitado con incidente
> `R-SIGNAL-01` (R5.11); Q-C aprobada la parte implementada (cabecera); Q-D `409
> ROBOT_START_IN_RESTRICTED_ZONE` (R12.2); Q-E posiciones iniciales (R12.5); Q-F una sola migración
> de la UI; Q-G migraciones en orden de entrega + `migrate.ts` endurecido; Q-H fila base
> `MIGRATION_BASELINE` (R9.8).

Solo el humano puede decidirlas (constitución art. XIII):
- **Q-A.** Autenticación del operador: la piden la HU-02 y la HU-05 del prototipo y el stack de
  CLAUDE.md (bcrypt + JWT en cookie HttpOnly). ¿Requisito transversal ahora (en la spec 001) o deuda
  documentada?
- **Q-B.** Botón "Perder conexión" en la UI (HU-04 del prototipo) frente a la reserva de inyección
  de fallos de la spec 003. ¿Se habilita (enviando `POST /api/robots/:robotId/position` con
  `MISSING`) o queda reservado?
- **Q-C.** Aprobación formal de esta spec, implementada en 773823a pero aún en "Borrador"
  (constitución art. XII).

## 12b. Riesgos aceptados [RC-01 rev2]

- **Sin autenticación del operador (Q-A, deuda documentada).** Cualquier cliente puede iniciar una
  sesión e invalidar la del operador (denegación de servicio, no movimiento: un `INVALID_SESSION`
  nunca mueve ni libera un robot); puede enviar la señal de pérdida (fallo seguro: lleva a
  `DEGRADED`); y puede desactivar una zona para que un `recover` pase (queda registrado en el snapshot
  de `RECOVER_COMPLETED` y en el registro de zonas de la spec 001, pero sin actor). La HU-02 y la
  HU-05 del prototipo piden autorización: se abordará en un bloque posterior (propuesta en la spec
  001 §11), añadiendo `actor` también a `audit_log` y `state_transition_log`.
- **`packages/backend/data/` versionada** (decisión previa del humano): una base de desarrollo
  subida al repositorio puede llevar migraciones aplicadas en otro orden; `migrate.ts` endurecido lo
  detecta al arrancar.

## 13. Registro de cambios

### RC-01 — Refuerzo de convergencia con el prototipo (2026-11-22, propuesto)
Motivo: la comparación de las 5 HU del prototipo con la rama `integration` (773823a) mostró que la
UI no usa este vigilante (sigue en `/api/simulation`), que hay dos vigilantes escribiendo en
`robot_state`, que las transiciones no se registran (B-1), que una lectura de posición puede
relocalizar el robot y que los incidentes no identifican robot ni regla ni son consultables por id.

| Cambio | Dónde |
|--------|-------|
| Vigilante único; retirada de `/api/simulation/*` y `/api/robot/*` | Introducción, R10, §6 |
| Registro de toda transición con causa (`state_transition_log`) | §2.2, R9 |
| Estado por robot y rutas `/api/robots/:robotId/*` | R1.8, R12, §6 |
| Sesión y secuencia (`INVALID_SESSION`, `DUPLICATE_EVENT`) | §4, R11 |
| Incidentes con `robot_id` y `rule`; `GET /api/incidents?robotId=` y `/:id` | R5.5–R5.8, §6 |
| Señal de pérdida → `DEGRADED` (`POSITION_QUALITY_LOST`) | R3.6, R8.6 |
| `recover`: `transitioned`, `409 RECOVERY_NOT_ALLOWED` + `cause`, zona **activa** expandida | §4, R4.4–R4.6 |
| Lecturas sin relocalización (`POSITION_CONFLICT`) y auditadas | §5.1, R8.5–R8.7 |
| Inmutabilidad de todos los registros | R5.9 |
| Arranque seguro por robot y registrado | R6.5 |
| Límites del plano explícitos | R1.9 |
| Preguntas abiertas Q-A, Q-B, Q-C | §12 |

Lo sustituido se conserva en el texto marcado "Sustituido por RC-01".

### RC-01 rev2 — Revisión del analista sobre 5da075e (2026-11-23, propuesto)
Decisiones del humano Q-A..Q-H y M-1 aceptadas (2026-11-23). Resolución de cada hallazgo en esta spec:

| Hallazgo | Resolución en la 002 |
|----------|----------------------|
| B-1 ciclos entre bloques | Plan U1/U2 sin dependencias hacia delante (tasks.md); `007_create_robots` va antes que 008–011 |
| B-2 doble migración de la UI | Eliminada (Q-F): una sola migración de la UI a `/api/robots/:robotId/*`; no hay etapa `/api/robot` |
| B-3 `robot_sessions` y tipos duplicados | La 002 usa `robot_sessions`, `MoveCommand`, `LastRequest`, `checkSequence` y `sessionService.startSession` de la 003 sin redefinirlos (R11.2, R11.6; design) |
| B-4 zona del incidente | `zone_name` en la migración 009 (R5.5) |
| B-5 auditoría revertida | Rechazos como resultados tipados; la auditoría se confirma (R5.10) |
| I-1 dos vigilantes en integraciones intermedias | R10.6: todo en la unidad U1 |
| I-2 orden de migraciones | Numeración en orden de entrega + `migrate.ts` endurecido (tasks U1) |
| I-3 estado sin transición inicial | Fila base `MIGRATION_BASELINE` (R9.8); migraciones escritoras autorizadas (R10.5) |
| I-4 posiciones iniciales | R12.5 (Q-E) |
| I-5 `ruleForDecision` duplicada | Se consume la de la spec 001 (R5.5) |
| I-6 `initRobot`/DEFAULT | `INSERT` simple que falla si existe; `position_quality` sin DEFAULT (R12.2; design) |
| I-7 robot dentro de zona activa | `409 ROBOT_START_IN_RESTRICTED_ZONE` (R12.2, Q-D) |
| I-8 pruebas afectadas | Listadas por archivo en cada tarea (tasks.md) |
| I-9 métodos y alias de la 003 | Retirada de `get`/`save`/`RobotSnapshot` y de `moveSchema` (tasks U1-5) |
| M-1 radio/margen | No aplica a esta spec (lo corrige la 001); T-12 D/E ya fijan r=10 y m=5 explícitos |
| M-2 estados de aprobación | Cabecera según Q-C |
| M-3 restos sin marcar | R6.2, cabecera de §6, DD-210, Property 10, §5b/§6 del design marcados |
| M-4 `BUSY` | Catálogo corregido (solo `MOVING` concurrente) |
| M-5 código de payload | `INVALID_MOVE_REQUEST` (R11.2) |
| M-6 CA de la 003 | No aplica a esta spec |
| M-7 contador de solicitudes | `lastRequest.sequence` del estado (R11.6) |
| M-8 línea "NNN" | No aplica a esta spec |
| M-9 contradicción `initRobot` en la 003 | No aplica a esta spec (la 002 ya define `initRobot`) |
| M-10 fechas no ISO | Repositorios normalizan a ISO-8601 UTC; columnas nuevas con `strftime` (design) |
| M-11 nombre `Incident` | Tipo de fila interno `IncidentRow` (design) |
| M-12 steering desalineado | No aplica a esta spec (anotado en la 001) |
| Q-B pérdida de señal | Incidente `R-SIGNAL-01` (R5.11), sustituye a DD-217 |

### RC-01 rev3 — Ronda final del analista sobre d84eb08 (2026-11-23, propuesto)
Decisiones del humano: **Q-I** (A1 siempre en (120, 90)) y **vistas del prototipo excluidas**
("Visión general" y el grupo "Ingeniería · SDD"; las registra la spec 003, dueña de la navegación).
Resolución de cada hallazgo en esta spec:

| Hallazgo | Resolución en la 002 |
|----------|----------------------|
| N-1 Q-E no implementable | Q-I: A1 = fila actual (120, 90) en toda base; V2 (488, 290); sin detección (R12.5; design 008; tasks RC-5) |
| N-2 quién valida el alta | `evaluateStartPosition` + `checkStartPosition` en el vigilante; `initRobot` solo inserta (R12.2; design §2 y §4; tasks RC-3, RC-15) |
| N-3 `audit_log` y el robot inexistente | `robot_id` y `state` nulos en la 011 para `ROBOT_START_IN_RESTRICTED_ZONE` (R5.10; design 011; tasks RC-8, RC-15) |
| N-4 unión `move` ↔ sesiones | `sessionService.acceptRequest` (003); la 002 no escribe `robot_sessions`; `ServiceResult` único (R11.6; design §1 y §4; tasks RC-16) |
| N-5 ciclos dentro de los pasos | Tabla "Orden intercalado de U1" en tasks.md; RC-1 partida en RC-1a/RC-1b |
| N-6 convivencia tras la 008 | RC-5 adapta las ~~seis~~ 4 sentencias (6 métodos; **[rev6]** N5-5) a `robot_id = 1`; métodos por robot en RC-10/RC-16; retirada en RC-20 |
| N-7 copia de `robot_sessions` y `LastRequest` | Eliminadas del design; solo referencia a la 003 |
| N-8 `IncidentCode` | `IncidentCode = DecisionCode \| 'POSITION_QUALITY_LOST'` (design §1; tasks RC-1a) |
| N-9 `denialRule` | Eliminado de RC-2: se usa `ruleForDecision` de la 001 |
| N-10 restos sin marcar | R4.1, §5.2, catálogo, §10; design §6, tabla de migraciones, Testing Strategy |
| N-11 compuertas | §11 y compuertas del design marcadas según Q-C |
| N-12 indicador de paradas | No aplica a esta spec (UI de la 003) |
| N-13 `SESSION_STARTED` | Lo audita `sessionService.startSession` (003); el CHECK de la 011 lo admite |
| N-14 dueño del montaje y la retirada | RC-20 (RC-19 se integra en ella); traslado de `pointSchema` a `schemas/point.schema.ts` |
| N-15 CHECKs de 008/009 | 009 sin "amplía `decision_code`"; CHECK de `position_quality` en la 008 |
| N-16 redacción de R10.5 | Corregida: la 010 escribe `state_transition_log` |
| N-17 semilla vía `initRobot` | Corregido: la semilla la crea la 008 y queda con `MIGRATION_BASELINE` (R9.5) |
| N-18 orden de criterios | R1, R9 y R10 reordenados sin renumerar |

### RC-01 rev4 — Pasada del analista sobre la rev3 local (2026-11-23, propuesto)
Decisiones del humano (2026-11-23): **(1)** alta con zonas no legibles → `409
ROBOT_START_NOT_VERIFIABLE` con `cause: ZONE_DATA_UNAVAILABLE` (art. XIII); **(2)** `/api/robots` se
monta de forma aditiva en la rama de trabajo antes de la UI (RC-17b) y RC-20 queda solo como
retirada; **(3)** las filas antiguas de `audit_log` se conservan con `robot_id` nulo y la regla se
impone con un trigger creado después de la copia; **(4)** se acepta que A1 y los robots nuevos
empiecen superpuestos en (120, 90) (limitación anotada en la spec 003).

| Hallazgo | Resolución en la 002 |
|----------|----------------------|
| B-1 la 011 aborta con filas antiguas | Filas antiguas copiadas con `robot_id` NULL; trigger `BEFORE INSERT` tras la copia; `append` antiguo con `robot_id = 1` hasta RC-20; prueba con filas antiguas (design 011; tasks RC-8) |
| I-1 typecheck roto por la retirada | 003 RC-21 (UI sin tipos antiguos) va antes de 002 RC-20 en la tabla de orden |
| I-2 E2E en rojo | Montaje aditivo en RC-17b; RC-18 es "rojo esperado" dentro de RC-20 |
| I-3 estado para auditar en `sessionService` | `acceptRequest(robotId, cmd, currentState)`; RC-9/RC-10 antes de 003 RC-5..RC-8 (R11.6; tasks) |
| I-4 lectura de `lastRequest` | `sessionService.getLastRequest(robotId)` (spec 003) en `getState` (R11.6; design §4; RC-16) |
| I-5 alta con zonas no legibles | Decisión (1): `ROBOT_START_NOT_VERIFIABLE` (R12.2, R5.10, catálogo; design; RC-3, RC-8, RC-15) |
| I-6 grafo de la 003 | No aplica a esta spec (la 002 publica la tabla; su grafo se ha actualizado) |
| I-7 `AUTHORIZED` | Respuesta con `state: IDLE` (R1.5; contrato marcado) |
| M-1 restos sin marcar | §8 Q-A → RA-01; design: `sessions` en la arquitectura |
| M-2 dueño de `/sessions` | La spec 003 (`robotsRoutes`); `guardianRoutes` monta solo `state`, `move`, `recover` y `position` (design §7; RC-16) |
| M-3 cita "§8" de la 003 | No aplica a esta spec |
| M-4 IDs obsoletos de la 003 | No aplica a esta spec |
| M-5 `zoneName` en `GuardianDecision` | Opcional (`zoneName?`) para mantener el paso 1 aditivo (design §1; RC-1b) |
| M-6 retorno de `initRobot` | `void`; lanza excepción si la fila existe o la posición es insegura (R12.2; design §4) |
| M-7 controller antiguo tras RC-10 | Invoca el servicio por robot con `robotId = 1` hasta RC-20 (RC-10) |
| M-8 Testing Strategy | Añadidos `evaluateStartPosition`, `checkStartPosition`, `ROBOT_START_NOT_VERIFIABLE` y la 011 con filas antiguas |
| M-9 ruta por defecto de la UI | No aplica a esta spec |
| M-10 orden de validación del alta | No aplica a esta spec (R7 de la 003); la 002 solo aporta el paso 3 (`checkStartPosition`) |
| M-11 posición compartida | Decisión (4), anotada en la 003; sin cambios en la 002 |

### RC-01 rev5 — Pasada del analista sobre la rev4 local (2026-11-23, propuesto)
Decisiones del humano (2026-11-23): **(1)** la unidad de "verde" es el par "prueba roja → implementación"
(una fila de la tabla de orden), no cada tarea suelta (N4-2); **(2)** el controller antiguo usa una vía
temporal `moveLegacy(robotId = 1, destination)` sin sesión mientras conviven los dos vigilantes en la rama
de trabajo (N4-4): desvío declarado de R11, nunca integrado, retirado en RC-20.

| Hallazgo | Resolución en la 002 |
|----------|----------------------|
| N4-1 E2E en rojo durante el paso 4 | Texto de la tabla corregido: el E2E pasa al final de cada fila desde el paso 4; 003 RC-15 (vocabulario) y RC-19 (rutas) lo adaptan, RC-22 lo amplía (tasks, tabla filas 20 y 22 en la numeración rev5; filas 19 y 21 desde la rev6) |
| N4-2 pruebas rojas que terminan en rojo | Decisión (1): la tabla se reorganiza en pares, una fila por par; encabezado con la unidad de verde (tasks, tabla rev5) |
| N4-3 restos de la 003 sin marcar | No aplica a esta spec (lo corrige la 003) |
| N4-4 `/api/robot/move` sin sesión | Decisión (2): `moveLegacy`; nota en R11, R10.7, RC-10, RC-16, RC-18, RC-20 y Property 12; pruebas afectadas listadas en RC-16 (design §4, DD-238) |
| M4-1 CA-03.28 | No aplica a esta spec |
| M4-2 restos rev3 sobre el montaje | Tachados en las reglas del plan y en los encabezados de los pasos 3 y 5 (tasks) |
| M4-3 redacción del "rojo esperado" | Lado 002: el rojo esperado es el paso (0) dentro de RC-20 (fila 24 en la numeración rev5; fila 23 desde la rev6); la 003 lo alinea |
| M4-4 `append` antiguo y columnas `x`/`y` | RC-8: el `append` antiguo escribe en `x`/`y` con `robot_id = 1`; prueba incluida |
| M4-5 dependencia hacia delante dentro de la fila de RC-11..RC-15 | RC-11 se limita a `SAFE_STOP_ACTIVE`/`BUSY`; las aserciones de `RECOVERY_NOT_ALLOWED` y `POSITION_CONFLICT` pasan a RC-12 y RC-13 |

### RC-01 rev6 — Pasada final del analista sobre la rev5 local (2026-11-23, propuesto) [RC-01 rev6]
Decisiones del humano (2026-11-23, aceptó las recomendaciones del coordinador): **(1)** `#/supervision` se
mantiene como ruta por defecto y los E2E existentes son dos archivos, `simulation.spec.ts` y
`rooms.spec.ts` (N5-1); **(2)** la prueba de dos robots de RC-17 pasa a RC-10 y RC-17 se retira (N5-3);
**(3)** `moveLegacy` queda acotado a tres pruebas y se retira con sus handlers (N5-2). Esta entrega no cambia
ningún requisito funcional de la 002: solo el plan de tareas y la redacción.

| Hallazgo | Resolución en la 002 |
|----------|----------------------|
| N5-1 E2E: `rooms.spec.ts` y testid de robot | Encabezado de la tabla y filas 19, 21 y 24 citan los dos E2E existentes; el testid `robot-<id>` y la adaptación de ambos E2E son de 003 RC-15 y RC-19 (tasks, tabla rev6) |
| N5-2 `moveLegacy` puede sobrevivir a RC-20 | Solo `robotController.test.ts`, `robot.api.test.ts` y `moveLegacy.test.ts` pueden referenciarlo; RC-16 lista las pruebas; RC-20 retira `moveLegacy.test.ts` y los handlers legacy de `controllers/robotController.ts`; RC-18 comprueba que no queda ninguna referencia; nota en R10.7 y R11; DD-238 reescrita y DD-240 (design) |
| N5-3 RC-17 nace en verde | La prueba de dos robots pasa a RC-10 (se ve fallar ahí); RC-17 se retira sin casilla; la tabla queda en 24 filas (tasks; design DD-240) |
| N5-4 tabla y grafos no idénticos | Fila 20 (Incidentes de la 003) depende también de la fila 18 (`incidentsApi`); nota de que las aristas extra del grafo de la 003 son orden de ejecución (tasks, tabla rev6) |
| N5-5 «seis sentencias» | «Las 4 sentencias (6 métodos)» en RC-5 y en la fila N-6 del registro de cambios (tasks) |
| N5-6 restos de redacción | RC-11 sin R4.4 ni R8.5 en sus Requisitos; Property 16 incluye RC-12; encabezados con rev5/rev6; DD-233 cita `ROBOT_START_NOT_VERIFIABLE`; numeración de filas anotada en este registro |
| N5-7 coherencia con `packages/` | Sin cambios: no se detectaron contradicciones con el código |
