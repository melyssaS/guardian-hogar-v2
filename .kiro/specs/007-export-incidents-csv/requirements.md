# Requirements Document

**Spec:** `007-export-incidents-csv`
**Fase MADA:** ENTENDER
**HU cubiertas:** HU-07
**Contexto:** demo en vivo (Fase 5 DEMOSTRAR). Responsable: **Melyssa** (decisión humana, 2026-11-24).
**Estado:** **Aprobado** por el humano (2026-11-24), revisión 2 (tras informe del analista-requisitos)

> Trazabilidad: Necesidad → Requisito → Historia → Prueba → Evidencia.
> Este documento captura **qué** debe hacer el sistema, no **cómo**.
>
> **Ubicación y número.** Esta spec vive en `specs/007-export-incidents-csv/` y se numera por
> HU (007 = HU-07), a diferencia de las specs 001–003 en `.kiro/specs/`. Decisión humana del
> 2026-11-24 (I-2).

---

## Introduction

El operador descarga los incidentes en formato CSV para analizarlos fuera de la plataforma.
Dominio: **Reportes**.

El CSV es una **proyección de solo lectura** de los incidentes de `GET /api/incidents` (spec 002
§6). No crea datos ni modifica la bitácora append-only. El backend genera el archivo
(columnas, codificación, escape, mitigación de fórmulas y nombre). La UI solo pide el archivo,
dispara la descarga y muestra los estados de carga y error (constitución art. III).

Punto de integración en la interfaz: el botón reservado **"Exportar CSV · HU-07"** de
`packages/frontend/src/pages/IncidentsPage.tsx`, hoy `disabled`. Esta spec lo habilita y
**sustituye para HU-07** el criterio RF-09.4 / CA-03.27 de la spec 003 (ver §6).

---

## 1. Historia de usuario

### HU-07 — Exportar incidentes a CSV
> Como **operador**, quiero **descargar los incidentes en formato CSV**, para **analizarlos
> fuera de la plataforma**.

### Criterios de la historia → CA
| Criterio de la historia | CA | Estado |
|-------------------------|----|--------|
| (a) Encabezados consistentes y UTF-8 válido | CA-07.1, CA-07.4, CA-07.6 | Cubierto |
| (b) Solo exporta datos del operador autenticado | — | **Diferido** por RA-07-01 (§5) |
| (c) Escapa campos con comas y comillas | CA-07.3 | Cubierto |
| (d) Nombre descriptivo con fecha | CA-07.5 | Cubierto |

---

## 2. Contrato de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/incidents/export?robotId=` | Incidentes como CSV. `robotId` opcional, con el mismo esquema Zod (`incidentListQuerySchema`) y el mismo alcance que `GET /api/incidents`. |

### Respuesta `200`
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="incidentes-YYYY-MM-DD.csv"` (fecha UTC de generación)
- `Access-Control-Expose-Headers` incluye `Content-Disposition`
- Cuerpo: BOM UTF-8 (`EF BB BF`) + fila de encabezados + una fila por incidente; filas separadas por `\r\n`.

### Columnas (orden fijo)
`id,robotId,robotName,rule,zoneName,decisionCode,collisionType,stateAfter,originX,originY,destX,destY,reason,createdAt`

### Errores (formato `{ code, message }`)
| HTTP | `code` | Causa |
|------|--------|-------|
| 404 | `ROBOT_NOT_FOUND` | `robotId` no existe (igual que `GET /api/incidents`). |
| 422 | `VALIDATION_ERROR` | `robotId` no es un entero positivo. |
| 429 | `TOO_MANY_REQUESTS` | Límite general de `/api` (ya existente en `app.ts`). |

---

## 3. Criterios de aceptación — API (RF-01)

**User Story:** Como operador, quiero un endpoint que devuelva los incidentes como CSV, para
descargarlos y analizarlos fuera de la plataforma.

1. **CA-07.1 — Encabezados y filas.** DADO que existen N incidentes CUANDO se pide `GET /api/incidents/export` ENTONCES la respuesta SHALL ser `200`, la primera fila (tras el BOM) SHALL ser exactamente la lista de columnas del §2, SHALL haber N filas de datos en el mismo orden que `GET /api/incidents` (más reciente primero), los números SHALL escribirse con `String(n)`, `createdAt` SHALL ser el ISO-8601 de la API y `null` SHALL ser una celda vacía.

2. **CA-07.2 — Alcance por `robotId`.** DADO que existen incidentes de los robots 1 y 2 CUANDO se pide `GET /api/incidents/export?robotId=1` ENTONCES el conjunto de `id` del CSV SHALL ser igual al de `GET /api/incidents?robotId=1` y NO SHALL contener incidentes del robot 2. DADO un `robotId` inexistente ENTONCES SHALL responder `404 ROBOT_NOT_FOUND` en JSON, sin CSV.

3. **CA-07.3 — Escape RFC 4180.** DADO un incidente cuyo `reason` o `zoneName` contiene `,`, `"`, `\n` o `\r` CUANDO se exporta ENTONCES esa celda SHALL ir entre comillas dobles, cada `"` interna SHALL duplicarse y, al reparsear el CSV con un parser RFC 4180, la fila SHALL tener 14 columnas y la celda SHALL recuperar su valor.

4. **CA-07.4 — UTF-8 con BOM.** DADO un incidente en la zona "Cuarto del bebé" CUANDO se exporta ENTONCES el cuerpo SHALL empezar por los bytes `EF BB BF`, SHALL decodificarse como UTF-8 sin errores, el texto decodificado SHALL contener `Cuarto del bebé` y la cabecera SHALL ser `Content-Type: text/csv; charset=utf-8`.

5. **CA-07.5 — Nombre con fecha.** DADO que el reloj del servidor marca `2026-11-23T23:59:59Z` CUANDO se exporta ENTONCES la respuesta SHALL incluir `Content-Disposition: attachment; filename="incidentes-2026-11-23.csv"`. En integración, el nombre SHALL cumplir `^incidentes-\d{4}-\d{2}-\d{2}\.csv$`. DADO un `Origin` permitido por CORS ENTONCES `Access-Control-Expose-Headers` SHALL incluir `Content-Disposition`.

6. **CA-07.6 — Sin incidentes.** DADO que no hay incidentes en el alcance pedido CUANDO se exporta ENTONCES SHALL responder `200` con el BOM y solo la fila de encabezados.

7. **CA-07.7 — Validación.** DADO `robotId=abc`, `robotId=0` o `robotId=-1` CUANDO se exporta ENTONCES SHALL responder `422 VALIDATION_ERROR` (Zod), sin CSV y sin trazas de pila.

8. **CA-07.8 — Solo lectura y sin auditoría.** DADO un número de filas en `incidents` y en `audit_log` CUANDO se exporta ENTONCES ambos números SHALL ser iguales después de la exportación (decisión humana 2026-11-24: la exportación no se audita).

9. **CA-07.9 — Mitigación de inyección de fórmulas.** DADO un incidente cuyo campo de texto (`robotName`, `zoneName` o `reason`) empieza por `=`, `+`, `-`, `@`, tabulador o `\r` CUANDO se exporta ENTONCES la celda SHALL empezar por `'` seguido del valor original (y después aplicarse el escape de CA-07.3). Las columnas numéricas (`id`, `robotId`, coordenadas) y las de vocabulario cerrado (`rule`, `decisionCode`, `collisionType`, `stateAfter`, `createdAt`) NO SHALL alterarse.

## 4. Criterios de aceptación — Interfaz (RF-02)

**User Story:** Como operador, quiero un botón que descargue el CSV; la UI solo muestra, el
backend genera.

10. **CA-07.10 — Descarga.** DADO que el operador está en "Incidentes" CUANDO pulsa el botón habilitado "Exportar CSV · HU-07" ENTONCES la UI SHALL hacer un único `GET /api/incidents/export` (sin `robotId`: la vista no filtra por robot) y SHALL descargar el archivo con el `filename` de `Content-Disposition`; IF la cabecera no se puede leer THEN SHALL usar `incidentes.csv`.

11. **CA-07.11 — Sin transformación.** CUANDO llega la respuesta `200` ENTONCES el `Blob` descargado SHALL ser el mismo recibido del backend: la UI NO SHALL construir, reordenar ni reescribir el CSV.

12. **CA-07.12 — Carga.** DADO que la petición está en curso ENTONCES el botón SHALL estar `disabled` y mostrar el texto "Exportando…"; al terminar SHALL volver a "Exportar CSV · HU-07" habilitado.

13. **CA-07.13 — Error.** DADO que el backend responde un error `{ code, message }` CUANDO el operador exporta ENTONCES la UI SHALL mostrar un `role="alert"` con el `message` y NO SHALL llamar a `URL.createObjectURL` ni disparar ninguna descarga.

14. **CA-07.14 — HU-06 sigue reservada.** CUANDO se muestra la vista "Incidentes" ENTONCES el botón "Filtrar por severidad · HU-06" SHALL seguir `disabled` y la nota SHALL referirse solo a HU-06.

---

## 5. Riesgos aceptados

| ID | Riesgo | Decisión | Fecha |
|----|--------|----------|-------|
| RA-07-01 | Sin autenticación, cualquier cliente que alcance la API puede exportar todos los incidentes. El criterio (b) de la historia no se cumple. | **Aceptado** por el humano. Los incidentes pertenecen a robots, no a operadores, y no hay auth (igual que spec 003 §11b). Cuando exista autenticación, se añadirá un CA que restrinja el alcance al operador. | 2026-11-24 |

---

## 6. Cambios a otras specs

| Spec | Criterio | Cambio |
|------|----------|--------|
| 003 | RF-09.4 / CA-03.27 | Para HU-07 queda **sustituido por 007 CA-07.10**. HU-06 sigue deshabilitado (CA-07.14). Se registra en el §12 de la 003 (tarea T0). |

---

## 7. Requisitos no funcionales

- **RNF-01** `robotId` se valida con Zod reutilizando `incidentListQuerySchema`.
- **RNF-02** Sin `any`; tipos compartidos de `@home-guardian/domain` (`Incident`).
- **RNF-03** El CSV se genera solo en el backend. El codificador es una función pura del
  backend y el frontend no tiene acceso a él.
- **RNF-04** Errores con `{ code, message }`, sin trazas de pila.
- **RNF-05** Solo lectura: no altera la bitácora de incidentes ni escribe en `audit_log`.

---

## 8. Compuerta Fase 1 (ENTENDER)
El humano aprueba explícitamente estos criterios antes de pasar a DISEÑAR.

- [x] **Aprobado** por el humano el 2026-11-24 (art. XIII). Siguiente compuerta: `design.md` (Fase 2).
