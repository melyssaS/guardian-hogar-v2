# Spec 001 — Zonas restringidas (`001-restricted-zones`)
# Requirements Document
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-01, HU-02
**Estado:** Borrador — pendiente de aprobación humana (compuerta Fase 1)

> Trazabilidad: Necesidad → Requisito → HU → Regla → Prueba → Evidencia.
> Este documento captura **qué** debe hacer el sistema, no **cómo**.

---

## Introduction

Esta spec cubre las HU-01 y HU-02 de Guardián Hogar: visualizar un plano 2D de la vivienda con las zonas restringidas activas, y gestionar (crear, modificar, activar, desactivar, eliminar) esas zonas. El corazón de la funcionalidad es un modelo geométrico único (sección «Modelo geométrico») que decide cuándo una trayectoria del robot colisiona con una zona, aplicando una expansión conservadora `r + m` y bordes inclusivos.

---

## 1. Historias de usuario

### HU-01 — Plano 2D con zonas activas
> Como **operador**, quiero **ver un plano 2D de la vivienda con cuadrícula y las zonas
> activas destacadas**, para **conocer el espacio donde se mueve el robot**.

### HU-02 — Gestión de zonas restringidas
> Como **operador**, quiero **crear, modificar, activar, desactivar y eliminar zonas
> restringidas**, para **impedir que el robot entre en ellas**.

---

## 2. Modelo geométrico — fuente única de verdad

Este modelo es compartido por backend y frontend. Reside en `@home-guardian/domain`.

| Concepto | Símbolo | Valor por defecto | Descripción |
|----------|---------|-------------------|-------------|
| Ancho del plano | `FLOOR_WIDTH` | `1000` | Eje X |
| Alto del plano | `FLOOR_HEIGHT` | `800` | Eje Y |
| Origen | — | `(0, 0)` | Esquina **arriba a la izquierda** |
| Zona | — | — | Rectángulo `(x, y, width, height)` |
| Radio del robot | `r` (`ROBOT_RADIUS`) | `0` | Para la expansión conservadora. Configurable por variable de entorno `ROBOT_RADIUS` |
| Margen de seguridad | `m` (`SAFETY_MARGIN`) | `0` | Holgura adicional. Configurable por variable de entorno `SAFETY_MARGIN` (pad total `r + m`) |

> **`r` y `m` son configurables por variable de entorno**, con valor por defecto `0`. Sin
> configuración explícita, la zona no se expande (`pad = r + m = 0`). Los escenarios de
> prueba y las specs que dependen de la expansión (p. ej. la spec 002) fijan `r` y `m`
> explícitamente para reproducir sus casos; no dependen del valor por defecto global.

### Reglas del modelo
1. **Expansión conservadora (AABB, DD-001):** cada zona se expande `r + m` por lado antes
   de evaluar colisión. Una zona `(x, y, w, h)` se evalúa como
   `(x - (r+m), y - (r+m), w + 2(r+m), h + 2(r+m))`. Con el valor por defecto
   (`r = m = 0`) la zona no se expande; `r` y `m` se configuran por variable de entorno.
2. **El borde pertenece a la zona:** las comparaciones son inclusivas (`≤`, `≥`). Un punto
   exactamente sobre el borde de la zona expandida **está dentro**.
3. **Dos comprobaciones de colisión:**
   - **Destino dentro:** el punto destino cae dentro de la zona expandida.
   - **Trayectoria interseca:** el segmento origen→destino corta la zona expandida
     (algoritmo **Liang-Barsky** de recorte de segmento contra AABB).
4. **Origen dentro = colisión:** si el origen ya está dentro de la zona expandida, es
   colisión (caso degenerado que Liang-Barsky debe reportar).

> El modelo geométrico es **puro** (sin efectos secundarios) y es la única autoridad sobre
> qué cuenta como colisión. Ni frontend ni persistencia replican esta lógica.

---

## Requirements

### 3. Requisitos funcionales

### RF-01 — Visualización del plano (HU-01)
- RF-01.1 El plano se dibuja a escala `FLOOR_WIDTH × FLOOR_HEIGHT` con origen arriba-izquierda.
- RF-01.2 Se muestra una cuadrícula de referencia sobre el plano.
- RF-01.3 Las zonas **activas** se dibujan destacadas sobre el plano en su posición y tamaño reales.
- RF-01.4 El plano refleja los cambios de zonas (alta, edición, activación, baja) tras recargar los datos.

### RF-02 — Gestión de zonas (HU-02)
- RF-02.1 Crear una zona con `name`, `x`, `y`, `width`, `height`.
- RF-02.2 Modificar los atributos de una zona existente.
- RF-02.3 Activar y desactivar una zona (campo `active`) sin eliminarla.
- RF-02.4 Eliminar una zona.
- RF-02.5 Listar zonas; por defecto solo las **activas**.

### RF-03 — Validaciones de zona
- RF-03.1 `name` obligatorio y **único**. Duplicado → **409 `ZONE_NAME_DUPLICATE`**.
- RF-03.2 `width > 0` y `height > 0`. Si no → **422 `INVALID_ZONE_DIMENSIONS`**.
- RF-03.3 La zona debe quedar **dentro del plano** (`0 ≤ x`, `0 ≤ y`,
  `x + width ≤ FLOOR_WIDTH`, `y + height ≤ FLOOR_HEIGHT`). Si no → **422 `ZONE_OUT_OF_BOUNDS`**.

### RF-04 — Persistencia
- RF-04.1 Las zonas se persisten en **SQLite** a través de un **repositorio** (sin acceso
  directo a la base desde controladores/servicios).
- RF-04.2 El esquema se crea y evoluciona mediante **migraciones SQL versionadas**.

---

## 4. Requisitos no funcionales

- RNF-01 Validación de todas las entradas con **Zod** antes de procesar.
- RNF-02 Sin `any` en TypeScript; contratos compartidos vía `@home-guardian/domain`.
- RNF-03 La lógica geométrica es **pura** y vive en `rules/` (reutilizable y testeable).
- RNF-04 Nunca exponer stack traces; errores con `code` estable y HTTP correcto.
- RNF-05 Las respuestas de error usan un formato uniforme `{ code, message }`.

---

## 5. Contrato de API

Base: `/api/zones`

### Entidad `Zone` (respuesta)
```json
{
  "id": 1,
  "name": "Escaleras",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 150,
  "active": true,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/zones` | Crear zona |
| `GET` | `/api/zones` | Listar zonas (ver filtro `active`) |
| `GET` | `/api/zones/:id` | Obtener una zona |
| `PUT` | `/api/zones/:id` | Modificar una zona (incluye activar/desactivar) |
| `DELETE` | `/api/zones/:id` | Eliminar una zona |

#### `GET /api/zones` — filtro `active`
| Query | Resultado |
|-------|-----------|
| (ninguno) | Solo zonas activas (por defecto) |
| `?active=all` | Todas las zonas |
| `?active=false` | Solo zonas inactivas |

#### `POST /api/zones`
Request:
```json
{ "name": "Escaleras", "x": 100, "y": 100, "width": 200, "height": 150, "active": true }
```
Respuestas:
- `201` → la `Zone` creada.
- `409 ZONE_NAME_DUPLICATE` → nombre ya existe.
- `422 INVALID_ZONE_DIMENSIONS` → `width` o `height` ≤ 0.
- `422 ZONE_OUT_OF_BOUNDS` → la zona excede el plano.

#### `PUT /api/zones/:id`
- `200` → la `Zone` actualizada.
- `404 ZONE_NOT_FOUND` → id inexistente.
- `409` / `422` → mismas validaciones que `POST`.

#### `DELETE /api/zones/:id`
- `204` → eliminada.
- `404 ZONE_NOT_FOUND` → id inexistente.

### Catálogo de errores
| HTTP | `code` | Causa |
|------|--------|-------|
| 404 | `ZONE_NOT_FOUND` | Id inexistente |
| 409 | `ZONE_NAME_DUPLICATE` | Nombre repetido |
| 422 | `INVALID_ZONE_DIMENSIONS` | `width` o `height` ≤ 0 |
| 422 | `ZONE_OUT_OF_BOUNDS` | Zona fuera del plano |

---

## 6. Criterios de aceptación (Given / When / Then)

### HU-01
- **CA-01.1** Dado el plano, cuando el operador abre la vista, entonces ve el plano a escala
  `1000 × 800` con cuadrícula y origen arriba-izquierda.
- **CA-01.2** Dadas zonas activas e inactivas, cuando se renderiza el plano, entonces solo
  las **activas** aparecen destacadas.

### HU-02
- **CA-02.1** Dado un nombre libre y dimensiones válidas dentro del plano, cuando se crea una
  zona, entonces responde `201` con la zona y queda persistida.
- **CA-02.2** Dado un nombre ya usado, cuando se crea otra zona con ese nombre, entonces
  responde `409 ZONE_NAME_DUPLICATE`.
- **CA-02.3** Dado `width ≤ 0` o `height ≤ 0`, cuando se crea/modifica, entonces responde
  `422 INVALID_ZONE_DIMENSIONS`.
- **CA-02.4** Dada una zona que excede el plano, cuando se crea/modifica, entonces responde
  `422 ZONE_OUT_OF_BOUNDS`.
- **CA-02.5** Dada una zona existente, cuando se modifica, entonces responde `200` con los
  nuevos valores persistidos.
- **CA-02.6** Dada una zona activa, cuando se desactiva (`active=false`), entonces deja de
  listarse por defecto y de destacarse en el plano, pero sigue existiendo.
- **CA-02.7** Dada una zona existente, cuando se elimina, entonces responde `204` y ya no
  aparece en ningún listado.
- **CA-02.8** Dado `GET /api/zones?active=all`, cuando se lista, entonces aparecen activas e
  inactivas.

---

## 7. Escenarios de borde B1–B9

Zona de referencia **Z1 = (x=100, y=100, width=200, height=150)** → rectángulo base con
la zona expandida por `r + m = 30`. **Estos escenarios fijan `r = 20` y `m = 10`
explícitamente** (no usan el valor por defecto `0`), para ejercitar la expansión
conservadora. Con ese pad, la **caja expandida** de Z1 va de `(70, 70)` a `(330, 280)`.
Cada escenario produce una prueba en Fase VERIFICAR.

| ID | Descripción | Entrada (origen → destino) | Resultado esperado |
|----|-------------|----------------------------|--------------------|
| **B1** | Destino claramente dentro de Z1 | `(0,0) → (200,175)` | **Colisión** (destino dentro) |
| **B2** | Destino claramente fuera, trayectoria no cruza | `(0,0) → (50,50)` | **Sin colisión** |
| **B3** | Trayectoria atraviesa Z1 aunque destino quede fuera | `(0,175) → (400,175)` | **Colisión** (trayectoria interseca) |
| **B4** | Origen ya dentro de Z1 | `(200,175) → (0,0)` | **Colisión** (origen dentro) |
| **B5** | Destino exactamente sobre el borde base de Z1 | `(0,0) → (100,175)` | **Colisión** (el borde pertenece a la zona) |
| **B6** | Destino fuera del borde base pero dentro de la banda de expansión | `(0,0) → (85,175)` (x=85 está entre 70 y 100) | **Colisión** (expansión conservadora) |
| **B7** | Destino fuera de la caja expandida (más allá de x=70) | `(0,0) → (69,175)` | **Sin colisión** |
| **B8** | Trayectoria tangente a la esquina de la caja expandida | segmento que toca `(330,280)` | **Colisión** (contacto = dentro, borde inclusivo) |
| **B9** | Segmento degenerado origen == destino, fuera de Z1 | `(50,50) → (50,50)` | **Sin colisión** |

> Notas:
> - En B6 el destino `x=85` está entre el borde expandido (`70`) y el borde base (`100`),
>   es decir dentro de la banda de expansión `r+m`, por lo que cuenta como colisión.
> - B8 valida el criterio de borde inclusivo sobre la **zona expandida**, no solo la base.
> - B4 y B9 cubren el caso degenerado del segmento (longitud cero) que Liang-Barsky debe
>   manejar sin dividir por cero.

---

## Glossary

| Término | Definición |
|---------|------------|
| Zona | Rectángulo restringido `(x, y, width, height)` donde el robot no debe entrar. |
| AABB | Axis-Aligned Bounding Box; caja alineada a los ejes usada para colisión. |
| Zona expandida | Zona ampliada `r + m` por lado (expansión conservadora, DD-001). |
| `r` / `m` | Radio del robot (`ROBOT_RADIUS`) y margen de seguridad (`SAFETY_MARGIN`). Configurables por variable de entorno, por defecto `0`. |
| Liang-Barsky | Algoritmo de recorte de segmento contra un AABB para detectar intersección. |
| Borde inclusivo | El contacto exacto con el borde cuenta como colisión (`≤`, `≥`). |

---

## 8. Fuera de alcance

- Autenticación y autorización (se trata en otra HU/spec).
- Formas de zona no rectangulares (polígonos, círculos).
- Trayectorias curvas (solo segmentos rectos).

---

## 9. Trazabilidad

```
HU-01, HU-02
  → requirements.md (este documento)
    → design.md
      → tasks.md
        → código (domain/geometry, backend/zones, frontend/RoomsPage)
          → pruebas (unit geometría B1–B9, integración API, e2e plano)
            → evidencia (CI verde + demo)
```

---

## 10. Compuerta Fase 1 (ENTENDER)

- [ ] El humano aprueba explícitamente este `requirements.md` antes de pasar a DISEÑAR.
