# Skill — MADA (Metodología Ágil de Desarrollo Asegurado)

## Qué es MADA
Metodología propia del Equipo 6 que integra prácticas ágiles con aseguramiento de calidad y seguridad desde la primera fase. Toda funcionalidad pasa por 6 fases obligatorias antes de llegar a producción.

## Las 6 fases

### Fase 1 — ENTENDER
**Objetivo**: capturar qué debe hacer el sistema, no cómo.
- Artefacto: `requirements.md`
- Responsable: humano escribe, **analista-requisitos** refina
- Contiene: historia de usuario, requisitos funcionales y no funcionales, criterios de aceptación en formato Dado/Cuando/Entonces, contrato de API
- **Compuerta**: el humano debe aprobar explícitamente antes de continuar

### Fase 2 — DISEÑAR
**Objetivo**: definir la arquitectura y los contratos técnicos.
- Artefacto: `design.md`
- Responsable: **analista-requisitos** genera, humano aprueba
- Contiene: componentes a crear, modelo de datos, dependencias entre HUs, decisiones de diseño justificadas
- **Compuerta**: el humano debe aprobar explícitamente antes de continuar

### Fase 3 — CONSTRUIR
**Objetivo**: implementar lo especificado, nada más.
- Artefactos: `tasks.md` + código fuente
- Responsable: **Dev Agent** genera, humano revisa
- El código debe seguir exactamente lo definido en design.md
- Cada tarea en tasks.md mapea a un criterio de aceptación
- **Compuerta**: todas las tareas deben estar completas antes de continuar

### Fase 4 — VERIFICAR
**Objetivo**: demostrar que el código cumple los criterios de aceptación.
- Artefacto: pruebas automatizadas
- Responsable: **revisor-qa-seguridad** revisa, humano valida resultados
- Cada criterio de aceptación debe tener al menos una prueba
- El **revisor-qa-seguridad** puede devolver el código al **Dev Agent** si encuentra fallos
- **Compuerta de oro**: todas las pruebas deben pasar antes de continuar

### Fase 5 — DEMOSTRAR
**Objetivo**: verificar el comportamiento ante el usuario/profesor.
- Artefacto: demostración funcional
- Responsable: humano demuestra
- La aplicación debe estar corriendo y responder a los escenarios de prueba
- **Compuerta**: aprobación del evaluador

### Fase 6 — OPERAR
**Objetivo**: desplegar y monitorear en producción.
- Artefacto: aplicación desplegada con URL accesible
- Responsable: humano despliega
- Incluye: variables de entorno configuradas, CI/CD activo, URL pública

---

## Compuerta de oro
Es el control más importante de MADA. Antes de pasar de Verificar a Demostrar:
- ✅ Todas las pruebas pasan
- ✅ Todos los criterios de aceptación están cubiertos
- ✅ No hay secretos en el código
- ✅ El humano ha revisado y aprobado

Si alguna condición falla → volver a Construir.

---

## Trazabilidad obligatoria
Cada artefacto debe referenciar la HU que lo originó:
```
HU-04 → requirements.md → design.md → tasks.md → código → pruebas → incidente en BD
```
Esta cadena debe ser demostrable en la sustentación.

---

## Backlog del proyecto
| HU | Fase actual | Responsable demo |
|----|-------------|-----------------|
| HU-01 | Línea base | — |
| HU-02 | Línea base | — |
| HU-03 | Línea base | — |
| HU-04 | Línea base | — |
| HU-05 | Línea base | — |
| HU-06 | Reservada demo | Sergio |
| HU-07 | Reservada demo | Julian |
| HU-08 | Reservada demo | Melyssa |
| HU-09 | Reservada demo | July |
| HU-10 | Comodín demo | Melyssa (backup) |
