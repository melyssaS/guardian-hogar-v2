# Requirements Document

**Spec:** `003-movement-simulation`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-03
**Estado:** Aprobado por el humano (2026-11-22, compuerta Fase 1)

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

---

## 1. Historia de usuario

### HU-03 — Simulación de movimiento con decisión del vigilante
> Como **operador**, quiero **elegir un destino en el plano (clic o coordenadas) y solicitar
> el movimiento**, para **ver la decisión del vigilante y el estado del robot**.

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
El vigilante evalúa la solicitud y devuelve una **decisión**:
| Decisión | Significado |
|----------|-------------|
| `ALLOW` | Destino y trayectoria libres; el robot se mueve al destino. |
| `PREVENTIVE_STOP` | Destino en zona o trayectoria que la cruza; el robot no se mueve (parada preventiva). |
| `DENIED_SAFE_STOP` | La solicitud se rechaza porque el robot ya está en `SAFE_STOP` (`SAFE_STOP_ACTIVE`). |

### 2.3 Transiciones (en alcance)
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

#### Acceptance Criteria
1. WHEN se solicita un movimiento THEN el sistema SHALL evaluar el segmento desde la posición actual del robot (origen) hasta el destino.
2. WHEN el backend evalúa la solicitud THEN el sistema SHALL devolver la decisión del vigilante y el estado resultante del robot.
3. WHEN la UI necesita una decisión THEN el sistema SHALL realizar la evaluación solo en el backend y la UI NO SHALL replicar la lógica de reglas.

### Requirement 3: Resultado del movimiento (RF-03)
**User Story:** Como operador, quiero ver el resultado del movimiento (permitido, parada
preventiva o denegado), para conocer el estado del robot.

#### Acceptance Criteria
1. WHEN el destino y la trayectoria están libres y el robot no está en SAFE_STOP THEN el sistema SHALL responder `ALLOW`, mover el robot a la nueva posición y devolver estado `MOVING` y luego `IDLE`.
2. WHEN el destino está dentro de una zona o la trayectoria la cruza THEN el sistema SHALL responder `PREVENTIVE_STOP`, mantener el robot en su posición de origen, devolver estado `SAFE_STOP` e indicar la causa (tipo de colisión).
3. IF el robot está en `SAFE_STOP` WHEN se solicita cualquier movimiento THEN el sistema SHALL responder `DENIED_SAFE_STOP` con `SAFE_STOP_ACTIVE` y NO SHALL cambiar la posición ni el estado del robot.

### Requirement 4: Representación en la interfaz (RF-04)
**User Story:** Como operador, quiero que la interfaz muestre la respuesta de la API, para
ver la decisión y el estado sin que la UI recalcule reglas.

#### Acceptance Criteria
1. WHEN la UI recibe la respuesta de la API THEN el sistema SHALL mostrar la decisión, el estado y la posición sin evaluar reglas en el cliente.
2. WHEN la decisión es `PREVENTIVE_STOP` THEN la UI SHALL mostrar una indicación de parada preventiva y su causa.
3. WHEN la decisión es `DENIED_SAFE_STOP` THEN la UI SHALL mostrar la denegación `SAFE_STOP_ACTIVE`.
4. WHEN se completa una solicitud THEN la UI SHALL reflejar la posición y el estado actuales del robot.
5. WHILE una solicitud está en curso THEN la UI SHALL manejar los estados de carga y error.

### Requirement 5: Registro de la decisión (RF-05)
**User Story:** Como equipo de QA/seguridad, quiero que cada decisión de movimiento se
registre con su causa, para mantener la trazabilidad.

#### Acceptance Criteria
1. WHEN se procesa una evaluación de movimiento THEN el sistema SHALL registrar la decisión, el tipo de colisión (si aplica), el origen, el destino y el estado resultante.
2. WHEN se registra una decisión THEN el registro SHALL ser inmutable (solo inserción, sin actualización ni borrado).

### Requirement 6: Calidad de contrato y determinismo (RNF)
**User Story:** Como desarrollador, quiero un contrato validado y decisiones deterministas,
para garantizar robustez y reproducibilidad.

#### Acceptance Criteria
1. WHEN se recibe una solicitud THEN el sistema SHALL validar la entrada con Zod antes de procesarla y SHALL rechazar un payload inválido con `422 INVALID_DESTINATION`.
2. WHEN ocurre un error THEN el sistema SHALL responder con formato `{ code, message }` y NO SHALL exponer trazas de pila.
3. WHEN se evalúan dos solicitudes que comparten el mismo origen, el mismo destino, las mismas zonas activas y el mismo estado del robot THEN el sistema SHALL producir en ambas la misma decisión (el determinismo se exige solo bajo esas condiciones iguales, no como propiedad global incondicional).

---

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

---

## 7. Fuera de alcance (reservado)

- **Inyección de fallos de sensor** (reservada para demo en vivo).
- **Alerta A-04** (reservada).
- **Prueba T-18** (reservada).
- Estados `DEGRADED` y `RECOVERING` de la máquina de estados (dependen de los sensores).
- Trayectorias curvas y movimiento con pasos intermedios/animación física.
- Autenticación y autorización.

---

## 8. Dependencias

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
