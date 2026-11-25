# Requirements Document

**Spec:** `008-incident-counts-by-type`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-08
**Estado:** Borrador (pendiente de aprobación humana)

> Trazabilidad: Necesidad → Requisito → Historia → Criterio → Prueba → Evidencia.
> Este documento captura **qué** debe hacer el sistema, no **cómo**.

---

## Introduction

Esta spec cubre la **HU-08** de Guardián Hogar: el operador ve, de un vistazo, cuántos
incidentes hay **agrupados por tipo**. Un "tipo" es la **regla** que originó el incidente
(`rule`), que ya es el eje estable del catálogo del dominio (`R-ZONA-01`, `R-SIGNAL-01`,
`R-DATA-01`; ver `packages/domain/src/rules/catalog.ts`). Es la agrupación natural de
"tipo de incidente" y no se solapa con la severidad de la HU-06 (filtro) ni con la
exportación de la HU-07.

La función es un **indicador** (constitución art. VIII): un conteo derivado de los incidentes
ya registrados, de **solo lectura**. No crea, modifica ni borra incidentes. La decisión de
qué cuenta como cada tipo la toma el **backend** (constitución art. III y RNF-03 de la 003):
la UI solo muestra lo que la API devuelve.

Se integra en el marcador reservado de la vista "Incidentes" (`IncidentsPage.tsx`), junto a
los botones ya deshabilitados de HU-06 y HU-07, sin alterar la tabla ni el detalle existentes
(spec 003 R9).

---

## 1. Historia de usuario

### HU-08 — Conteos de incidentes por tipo
> Como **operador**, quiero **visualizar el número de incidentes agrupados por tipo**, para
> **tener una vista rápida del estado del sistema**.

**Dominio:** Indicadores.

---

## 2. Conceptos

### 2.1 "Tipo" de incidente
El tipo es la **regla** (`rule: RuleId`) del incidente. Las categorías son el catálogo fijo
del dominio:

| Tipo (`rule`) | Título mostrado |
|---------------|-----------------|
| `R-ZONA-01` | No circular por zonas restringidas |
| `R-SIGNAL-01` | Posición no confiable o ausente |
| `R-DATA-01` | Información de zonas no disponible |

> Las categorías son las tres reglas del catálogo. El conteo de una categoría sin incidentes
> es **0** (no se omite la categoría), para que la vista sea estable y comparable.

### 2.2 Indicador, no regla
El conteo es un **indicador derivado** (art. VIII): se calcula sobre los incidentes ya
existentes. No es una regla de seguridad y no cambia ninguna decisión del vigilante.

---

## Requirements

### Requirement 1: Conteo de incidentes por tipo (RF-01)
**User Story:** Como operador, quiero un conteo de incidentes por tipo calculado por el
backend, para que el indicador no dependa de la interfaz.

#### Acceptance Criteria
1. **CA-08.1** WHEN el operador consulta los conteos THEN el sistema SHALL devolver, por cada
   tipo del catálogo (`R-ZONA-01`, `R-SIGNAL-01`, `R-DATA-01`), el número de incidentes de ese
   tipo y el total.
2. **CA-08.2** WHEN se suman los conteos de todos los tipos THEN el total SHALL ser igual al
   número de incidentes que devuelve `GET /api/incidents` **sin filtros** (la consulta completa,
   sin `robotId`). Esta HU no filtra por robot (ver DD-08.6); el conteo es siempre global.
3. **CA-08.3** IF no hay incidentes THEN el sistema SHALL devolver `0` en cada tipo y `0` en el
   total (sin omitir ninguna categoría).
4. **CA-08.4** WHEN se calculan los conteos THEN el sistema NO SHALL crear, modificar ni borrar
   ningún incidente (los registros originales no se alteran).
5. **CA-08.5** WHEN el cálculo se ejecuta sobre un conjunto de incidentes dado THEN SHALL ser
   determinista: el mismo conjunto produce siempre los mismos conteos.

### Requirement 2: Visualización en la interfaz (RF-02)
**User Story:** Como operador, quiero ver los conteos en la vista "Incidentes", para leer el
estado sin que la UI recalcule nada.

#### Acceptance Criteria
1. **CA-08.6** WHEN el operador abre la vista "Incidentes" THEN la UI SHALL mostrar, en el
   marcador reservado para la HU-08, un conteo por cada tipo del catálogo con su título legible
   y el total, tomados de la API sin recalcularlos en el cliente.
2. **CA-08.7** WHEN la vista "Incidentes" se vuelve a montar (recarga del navegador o
   navegación de salida y regreso) THEN los conteos SHALL reflejar los incidentes vigentes en
   ese momento, pidiéndolos de nuevo a la API (se actualizan al recargar). "Recargar" = volver
   a montar la página; esta HU no añade un botón de recarga propio.
3. **CA-08.8** IF no hay incidentes THEN la UI SHALL mostrar `0` en cada tipo (estado vacío
   explícito, sin ocultar categorías).
4. **CA-08.9** WHILE la consulta de conteos está en curso o falla THEN la UI SHALL manejar los
   estados de carga y error, sin romper la tabla ni el detalle existentes.

---

## 3. Requisitos no funcionales

- **RNF-01** La entrada (si la hubiera, p. ej. `robotId`) se valida con **Zod** antes de
  procesar; un payload inválido responde `422` con `{ code, message }`.
- **RNF-02** Sin `any` en TypeScript; el contrato del conteo se define en
  `@home-guardian/domain` y lo comparten backend y frontend.
- **RNF-03** La lógica de agregación es del **backend**; la UI solo muestra.
- **RNF-04** Nunca exponer stack traces; errores con `code` estable y HTTP correcto.
- **RNF-05** Solo lectura: no hay `UPDATE` ni `DELETE` de incidentes (incidentes inmutables).

---

## 4. Contrato de API

Nuevo endpoint de solo lectura:

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/incidents/counts` | Conteo de incidentes por tipo (regla) y total |

Respuesta `200`:
```json
{
  "total": 3,
  "byType": [
    { "rule": "R-ZONA-01", "title": "No circular por zonas restringidas", "count": 2 },
    { "rule": "R-SIGNAL-01", "title": "Posición no confiable o ausente", "count": 1 },
    { "rule": "R-DATA-01", "title": "Información de zonas no disponible", "count": 0 }
  ]
}
```

> `byType` incluye **siempre** las tres categorías del catálogo, en el orden del catálogo,
> aunque su `count` sea `0` (CA-08.3). `total` es la suma de los `count` (CA-08.2).
> El endpoint **no acepta parámetros** (sin `robotId`): el conteo es global sobre todos los
> incidentes (DD-08.6). La ruta `/counts` se define **antes** de `/:id` en el router para que no
> la capture el parámetro `:id` (ver design.md DD-08.5); una prueba lo verifica (tasks.md T4).

Sin incidentes, respuesta `200`:
```json
{
  "total": 0,
  "byType": [
    { "rule": "R-ZONA-01", "title": "No circular por zonas restringidas", "count": 0 },
    { "rule": "R-SIGNAL-01", "title": "Posición no confiable o ausente", "count": 0 },
    { "rule": "R-DATA-01", "title": "Información de zonas no disponible", "count": 0 }
  ]
}
```

---

## 5. Fuera de alcance

- Filtro por severidad (HU-06) y exportación a CSV (HU-07): reservadas aparte.
- Conteos por otra dimensión (zona, robot, decisión): esta HU agrupa **por tipo = regla**.
- Gráficos; la HU pide **conteos** (números), no visualización gráfica (art. VIII: indicador).

---

## 6. Trazabilidad

| Criterio | Requisito | Verificación (ver tasks.md) |
|----------|-----------|------------------------------|
| CA-08.1 | RF-01 | Prueba de dominio: agregación devuelve las 3 categorías + total |
| CA-08.2 | RF-01 | Prueba de integración: total = longitud de `GET /api/incidents` sin filtros |
| CA-08.3 | RF-01 | Prueba de dominio e integración: sin incidentes → todo en 0 |
| CA-08.4 | RF-01 | Prueba de integración: los incidentes no cambian tras consultar conteos |
| CA-08.5 | RF-01 | Prueba de dominio: mismo conjunto → mismos conteos |
| CA-08.6 | RF-02 | Prueba de componente: render de los 3 tipos + total desde la API |
| CA-08.7 | RF-02 | Prueba de componente: recargar vuelve a pedir y refleja el nuevo valor |
| CA-08.8 | RF-02 | Prueba de componente: sin incidentes → muestra 0 por tipo |
| CA-08.9 | RF-02 | Prueba de componente: estados de carga y error |

---

## 7. Registro de cambios

| Rev | Fecha | Cambio |
|-----|-------|--------|
| rev1 | 2026-11-24 | Revisión del analista-requisitos (REQUIERE CAMBIOS). Correcciones: **H-1** CA-08.2 ahora dice "sin filtros" y el endpoint no acepta `robotId`; **H-2** T4 añade prueba de que `/counts` precede a `/:id`; **H-3** los tipos van en `models/` (no `schemas/`); **H-4** CA-08.7 define "recargar" = remontar la página; **H-5** el estado de `counts` queda aislado en `status.counts`; **H-6** DD-08.8 agrupa por `Incident.rule` normalizado; **H-7** DD-08.9 cliente sin parámetros. |
