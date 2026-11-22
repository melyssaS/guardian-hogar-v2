# Skill — Backend (Node.js + TypeScript + Express)

## Fase MADA que aplica: CONSTRUIR y VERIFICAR

## Stack obligatorio
- Node.js 20
- TypeScript 5
- Express 4
- Prisma ORM + SQLite (dev) / PostgreSQL (CI y producción)
- Zod (validación)
- helmet (cabeceras de seguridad HTTP)
- express-rate-limit (límite de peticiones)
- bcrypt (hash de contraseñas)
- JWT en cookie httpOnly (autenticación)
- Vitest (pruebas unitarias)
- Supertest + PostgreSQL real (pruebas de integración en CI)
- Playwright (pruebas E2E de humo)
- ESLint + Prettier (calidad)

## Estructura de carpetas
```
packages/backend/
├── src/
│   ├── controllers/    un controlador por recurso
│   ├── services/       lógica de negocio
│   ├── repositories/   acceso a datos via Prisma
│   ├── rules/          motores de reglas — lógica pura
│   ├── middlewares/    auth, validación, manejo de errores
│   ├── routes/         definición de rutas Express
│   ├── schemas/        esquemas Zod por recurso
│   └── app.ts          configuración de Express
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── tests/
│   ├── unit/
│   └── integration/
├── tsconfig.json
└── package.json
```

## Principios SOLID aplicados
- **S**: controladores solo reciben y responden — delegan a servicios
- **O**: nuevas reglas se agregan sin modificar `zoneRuleEngine.ts`
- **D**: servicios reciben repositorios por parámetro — no los instancian

## Convenciones — fase CONSTRUIR
- Prohibido usar `any` — tipar todo con TypeScript
- Validar todas las entradas con Zod en `schemas/`
- Funciones puras en `rules/` — sin efectos secundarios
- Servicios reciben dependencias por parámetro (inyección manual)
- Manejo centralizado de errores en `middlewares/errorHandler.ts`
- Usar tipos del paquete `@home-guardian/domain` para contratos compartidos

## Convenciones — fase VERIFICAR
- Una prueba por criterio de aceptación mínimo
- Pruebas unitarias con Vitest para servicios y reglas
- Pruebas de integración con Supertest para endpoints
- Base de datos SQLite en memoria para pruebas
- Nombre de archivos: `[nombre].test.ts`

## Seguridad
- **JWT en cookie httpOnly** en todos los endpoints `/api/**` — nunca en localStorage
- Contraseñas hasheadas con **bcrypt** — nunca en texto plano
- **helmet** activo en toda la aplicación para cabeceras HTTP seguras
- **express-rate-limit** para prevenir abuso en endpoints públicos
- Credenciales desde variables de entorno — nunca hardcodeadas
- CORS restringido a `CORS_ORIGINS`
- Sanitizar todas las entradas con Zod antes de procesarlas
- Nunca exponer stack traces en respuestas

## Lo que NO hacer
- No `any` en TypeScript
- No lógica en controladores
- No llamadas a Prisma directamente desde controladores
- No secretos hardcodeados
- No implementar HU-06 a HU-10 en línea base
