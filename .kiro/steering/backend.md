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
- Docker (contenedor de ejecución — dev y demo)

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
├── Dockerfile          multi-stage: deps → build → runtime Node 20
├── tsconfig.json
└── package.json
```

## Docker
El backend se ejecuta en contenedor para evitar instalar Node, npm o Prisma en la máquina local. Se usa tanto en desarrollo (hot reload) como en demo (imagen compilada).

- **Dockerfile multi-stage** en `packages/backend/Dockerfile`:
  - `deps`: `node:20-slim`, copia los `package.json` del root y de los tres workspaces, `npm ci`.
  - `build`: compila `@home-guardian/domain` y `backend`, ejecuta `prisma generate`.
  - `runtime`: solo `dist` + dependencias de producción + Prisma Client. Incluir `openssl` (requerido por Prisma en imágenes slim).
- **Base de datos SQLite en volumen nombrado** (ej. `guardian-db:/data`) con `DATABASE_URL=file:/data/dev.db`. Nunca dejar el archivo `.db` dentro del contenedor sin volumen — se perdería en cada rebuild.
- **Arranque del contenedor**: `prisma migrate deploy` (o `db push` en dev) y luego `node dist/...`.
- **Orquestación** con `docker-compose.yml` (base, demo/prod con imágenes compiladas) y `docker-compose.dev.yml` (override con hot reload vía `tsx watch` y bind mount de `./packages`).
- **Hot reload en dev**: montar el código como bind mount y usar un volumen anónimo sobre `node_modules` para que el host no lo pise.
- **Variables de entorno** desde `.env` en la raíz — nunca hardcodeadas en el Dockerfile. `.env` siempre en `.gitignore`.
- Nota de fidelidad: en Docker local se usa SQLite en volumen; para producción real (Render) se mantiene PostgreSQL según la arquitectura.

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
- No secretos ni credenciales dentro del Dockerfile — siempre desde `.env`
- No dejar la base SQLite fuera de un volumen nombrado
