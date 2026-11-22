# Skill — Seguridad y Calidad

## Fase MADA que aplica: VERIFICAR y compuerta de oro

## Seguridad
- **JWT en cookie httpOnly** — nunca en localStorage
- Contraseñas hasheadas con **bcrypt** — nunca en texto plano
- **helmet** activo en toda la aplicación
- **express-rate-limit** en endpoints públicos
- Validar todas las entradas con Zod
- Nunca exponer stack traces en respuestas
- Cero secretos en código fuente
- `.env` en `.gitignore` siempre
- CORS restringido a `CORS_ORIGINS`
- Incidentes inmutables — sin DELETE ni UPDATE
- Idempotencia: `eventKey = robotId:simulationId:sequence`

## Checklist compuerta de oro
Antes de aprobar cualquier HU, verificar:
- [ ] Todas las pruebas pasan
- [ ] Cada criterio de aceptación tiene prueba
- [ ] Sin secretos en el código (`git grep -i password`)
- [ ] helmet y rate-limit activos
- [ ] JWT en cookie httpOnly — no en localStorage
- [ ] Sin `any` en TypeScript
- [ ] HU reservadas sin implementar
- [ ] CI pipeline pasa
