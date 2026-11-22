# Constitución del Proyecto — MADA Guardian (Guardián Hogar)

**Equipo 6 — EAFIT**
**Metodología MADA:** Scrum + Modelo V + STPA + Casos de Seguridad + DevOps/SRE

> Documento rector del proyecto. Define los principios no negociables que gobiernan el
> diseño, la implementación, la verificación y la gobernanza de Guardián Hogar.

---

## Principios

### I. Principio rector
El **nivel de riesgo determina el rigor de verificación**. A mayor riesgo asociado a una
funcionalidad, mayor es la exigencia de análisis, pruebas y evidencia antes de aceptarla.

### II. Separación simulación / operación real
Guardián Hogar es un **prototipo académico**: funciona **sin hardware físico, sin operación
real y sin certificaciones**. Toda operación ocurre en simulación.

### III. Seguridad desde el diseño
El **vigilante es independiente del frontend**. Ante **información insuficiente**, el sistema
ejecuta una **parada preventiva** (fallo seguro por defecto).

### IV. Máquina de estados explícita
Los estados del sistema son: **IDLE, MOVING, SAFE_STOP, DEGRADED, RECOVERING**.
**Toda transición se registra con su causa.**

### V. TDD y BDD no negociables para reglas críticas
Para las reglas críticas: **prueba roja antes de implementar** (TDD) y especificación de
comportamiento en formato **Given / When / Then** (BDD).

### VI. Trazabilidad
Cadena de trazabilidad extremo a extremo:

```
Necesidad → Peligro STPA → Requisito → Regla → Historia → Prueba → Evidencia → Versión
```

Ejemplo: **P1 → R-07 → HU-04 / HU-05 → T-12 → CS-03**

Y a nivel de desarrollo:

```
Requisito → Plan → Tarea → Código → Prueba → Revisión → Evidencia
```

### VII. Desarrollo incremental por funcionalidad vertical
Cada funcionalidad se construye de forma vertical completa:
**frontend → API → dominio → persistencia**.

### VIII. Distinción conceptual
Se distingue con precisión entre: **regla, indicador, escenario, resultado medido e
ilustración**. No se confunden entre sí.

### IX. Stack tecnológico
- **Frontend:** React + TypeScript + Vite
- **Backend:** Node.js 24 + Express + TypeScript
- **Monorepo:** npm workspaces
- **Persistencia:** SQLite + better-sqlite3 (**sin ORM**)
- **Validación:** Zod
- **Pruebas:** Vitest, Supertest, React Testing Library, Playwright
- **Calidad de código:** ESLint, Prettier
- **Seguridad:** helmet, express-rate-limit, bcrypt y JWT en cookie **HttpOnly**
- **CI/CD:** GitHub Actions (validación, pruebas, seguridad, construcción, entrega)
- **Despliegue:** Render con una imagen Docker

### X. Principios de ingeniería
**SOLID, KISS, YAGNI** y **arquitectura modular**.
**Código en inglés; documentación en español.**

### XI. Privacidad
**Sin datos personales.** Los **secretos residen únicamente en variables de entorno**.

### XII. Spec Kit como proceso oficial
**Spec Kit es el proceso oficial.** **Ninguna Historia de Usuario (HU) avanza sin su spec
aprobada.**

### XIII. Validación humana de decisiones críticas
Toda **decisión crítica requiere validación humana** explícita.

### XIV. Agentes especializados
Agentes especializados —**analista, desarrollador, revisor QA**— con **revisión
independiente y colaboración verificable**.

### XV. Evidencias reales
**Solo evidencias reales.** **Prohibido fabricar registros** o resultados.

### XVI. Gobernanza
Las **enmiendas a esta constitución requieren razón, acuerdo del equipo y fecha.**

---

## Registro de enmiendas

| Fecha | Versión | Razón | Acuerdo del equipo |
|-------|---------|-------|--------------------|
| —     | 1.0     | Versión inicial | Equipo 6 EAFIT |
