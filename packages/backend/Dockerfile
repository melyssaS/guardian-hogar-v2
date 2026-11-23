# syntax=docker/dockerfile:1
# Backend Home Guardian — contexto de build: RAÍZ del monorepo (npm workspaces).
#   docker build -f packages/backend/Dockerfile -t home-guardian-backend .

# ── deps: instala todas las dependencias del workspace ────────────────────────
FROM node:24-slim AS deps
# Toolchain para compilar el binario nativo de better-sqlite3.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json   packages/domain/package.json
COPY packages/backend/package.json  packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci

# ── build: compila domain + backend a dist/ ───────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/domain  packages/domain
COPY packages/backend packages/backend
RUN npm run build -w @home-guardian/domain \
    && npm run build -w @home-guardian/backend

# ── prod-deps: solo dependencias de producción (binario nativo recompilado) ───
FROM deps AS prod-deps
WORKDIR /app
RUN npm ci --omit=dev

# ── runtime: imagen final mínima ──────────────────────────────────────────────
FROM node:24-slim AS runtime
# openssl requerido en imágenes slim; dumb-init para señales (PID 1) limpias.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl dumb-init \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app

# node_modules de producción del monorepo (incluye better-sqlite3 ya compilado).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json

# Paquete domain compilado, resuelto por el symlink de workspace en node_modules.
COPY --from=build /app/packages/domain/dist         ./packages/domain/dist
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json

# Backend compilado + migraciones (migrate.ts las busca en ../../migrations).
COPY --from=build /app/packages/backend/dist         ./packages/backend/dist
COPY --from=build /app/packages/backend/package.json ./packages/backend/package.json
COPY packages/backend/migrations                     ./packages/backend/migrations

# Carpeta de datos para la BD SQLite (DB_FILE), propiedad del usuario node.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

ENV PORT=3000
EXPOSE 3000
# El servidor aplica migraciones y siembra al arrancar (server.ts → initDatabase).
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/backend/dist/server.js"]
