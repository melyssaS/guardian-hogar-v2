# Requirements Document

**Spec:** `002-safety-guardian`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-04, HU-05
**Estado:** Borrador — pendiente de aprobación humana (compuerta Fase 1)

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
  **segura** (fuera de toda zona) y los **datos son confiables**.

## 5. Aporte de lecturas de posición y reinicio seguro (ADR-10)

### 5.1 Cómo `positionQuality` llega a `RELIABLE`
El robot no puede moverse ni recuperarse con `positionQuality` en `MISSING`/`UNRELIABLE`. Dado
que los sensores reales quedan **reservados para HU-06**, en la línea base se provee una **vía
explícita** para aportar una lectura confiable:

- **`POST /api/robot/position`** con `{ position: {x,y}, quality: 'RELIABLE' }` registra una
  lectura confiable y fija `positionQuality = RELIABLE` y la posición del robot.
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
  entonces se exige una nueva lectura confiable antes de volver a moverse.
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
7. IF el origen o el destino están dentro de una zona activa y además la trayectoria cruza otra zona THEN el vigilante SHALL priorizar el chequeo de origen/destino y denegar con `ORIGIN_IN_RESTRICTED_ZONE` o `RESTRICTED_ZONE_VIOLATION` (origen antes que destino, y ambos antes que trayectoria).
5. WHEN ninguna condición de denegación aplica THEN el vigilante SHALL responder `AUTHORIZED`, actualizar la posición al destino y dejar el robot de nuevo en `IDLE` (el estado `MOVING` es transitorio y se completa en la misma solicitud), de modo que un movimiento exitoso no bloquee al siguiente.
6. WHEN el vigilante evalúa la geometría THEN el sistema SHALL reutilizar `isCollision` de la spec 001 y NO SHALL recalcular la geometría por su cuenta.

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

### Requirement 4: Recuperación explícita y validada (HU-05)
**User Story:** Como responsable de seguridad, quiero que la salida de la parada preventiva
sea explícita y validada, para evitar reanudaciones inseguras.

#### Acceptance Criteria
1. WHEN se solicita `POST /api/robot/recover` con posición segura (fuera de toda zona) y datos confiables THEN el vigilante SHALL transicionar a `RECOVERING` y luego a `IDLE`.
2. IF la posición no es segura o los datos no son confiables WHEN se solicita la recuperación THEN el vigilante SHALL permanecer en el estado de parada y SHALL rechazar la recuperación.
3. WHEN el robot está fuera de `SAFE_STOP`/`DEGRADED` THEN una solicitud de recuperación SHALL ser idempotente o rechazada sin efectos secundarios.

### Requirement 5: Registro de evaluaciones e incidentes (HU-04, HU-05)
**User Story:** Como responsable de seguridad, quiero que cada evaluación y cada denegación
queden registradas, para mantener la trazabilidad.

#### Acceptance Criteria
1. WHEN el vigilante evalúa un movimiento THEN el sistema SHALL registrar la evaluación con su `collisionType` (o causa de datos) y un snapshot de las zonas usadas en la decisión.
2. WHEN una evaluación termina en denegación que lleva a parada THEN el sistema SHALL crear un incidente asociado a esa decisión.
3. IF una nueva solicitud se rechaza por estado (`SAFE_STOP_ACTIVE`/`BUSY`) THEN el sistema NO SHALL crear un incidente por ese rechazo, pero SHALL registrar el rechazo en un log de auditoría (registro distinto de los incidentes) para fines de trazabilidad.
4. WHEN se crea un incidente THEN el registro SHALL ser inmutable (solo inserción).

### Requirement 6: Reinicio seguro (ADR-10)
**User Story:** Como responsable de seguridad, quiero que el arranque del servicio sea seguro,
para no reanudar movimientos tras un reinicio.

#### Acceptance Criteria
1. WHEN el servicio arranca THEN el sistema SHALL iniciar con `positionQuality = RELIABLE` y estado `IDLE` (seed), de modo que la demo pueda mover el robot desde el primer uso.
2. IF se recibe una señal de pérdida de posición explícita (`POST /api/robot/position` con `quality` igual a `MISSING` o `UNRELIABLE`) THEN el sistema SHALL poner `positionQuality` en ese valor y exigir una nueva lectura confiable antes de volver a moverse.
3. IF al arrancar existe un estado `MOVING` persistido THEN el sistema SHALL transicionar el robot a `SAFE_STOP` y NO SHALL reanudar el movimiento.
4. WHEN el servicio arranca de forma normal (sin señal de pérdida) THEN el sistema NO SHALL poner `positionQuality` en `MISSING` por el solo hecho de reiniciar.

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
1. WHEN se solicita `POST /api/robot/position` con una posición válida y `quality = RELIABLE` THEN el sistema SHALL fijar la posición del robot y `positionQuality = RELIABLE`.
2. IF el payload de posición es inválido o `quality` no es un valor admitido THEN el sistema SHALL rechazar con `422` y NO SHALL cambiar la posición ni la calidad.
3. WHEN `positionQuality` pasa a `RELIABLE` y el robot está en `IDLE` THEN un movimiento posterior SHALL poder evaluarse por geometría (ya no se deniega por datos).
4. WHEN se aporta una lectura de posición THEN el sistema NO SHALL simular un sensor real; la vía es un sustituto de prototipo, explícito y auditable, de la telemetría reservada para HU-06.

## 6. Contrato de API

Base: `/api/robot` e `/api/incidents`

### Endpoints
| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/robot/state` | Estado, posición y `positionQuality` actuales |
| `POST` | `/api/robot/move` | Evaluar y (si procede) autorizar un movimiento |
| `POST` | `/api/robot/position` | Aportar una lectura de posición confiable (fija `positionQuality`) |
| `POST` | `/api/robot/recover` | Recuperación explícita y validada |
| `GET` | `/api/incidents` | Listar incidentes registrados |

#### `POST /api/robot/move`
Request:
```json
{ "destination": { "x": 250.0, "y": 175.0 } }
```
Respuesta `AUTHORIZED` (200):
```json
{ "decision": "AUTHORIZED", "state": "MOVING", "position": { "x": 250.0, "y": 175.0 } }
```

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
| Rechazo por estado | `BUSY` | Movimiento pedido durante `MOVING`/`RECOVERING` |

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
- Autenticación y autorización.

## 9. Dependencias

- **spec `001-restricted-zones`**: modelo geométrico, `Zone`, `isCollision`, `CollisionType`.
- **spec `003-movement-simulation`**: consume el vigilante desde la UI (muestra la decisión).

## 10. Trazabilidad

```
HU-04, HU-05
  → requirements.md (este documento)
    → design.md
      → tasks.md
        → código (backend/rules watchman, state machine, incidents)
          → pruebas (T-12 28 escenarios, integración /api/robot, /api/incidents)
            → evidencia (CI verde + demo)
```

## 11. Compuerta Fase 1 (ENTENDER)

- [ ] El humano aprueba explícitamente este `requirements.md` antes de pasar a DISEÑAR.
