# syntax=docker/dockerfile:1
# Frontend Home Guardian — contexto de build: RAÍZ del monorepo (npm workspaces).
#   docker build -f packages/frontend/Dockerfile -t home-guardian-frontend .

# ── deps: instala solo lo que el frontend necesita ────────────────────────────
# Se omite el workspace backend a propósito: arrastra better-sqlite3 (binario
# nativo) que exige Python y toolchain, inútil para servir estáticos con nginx.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json   packages/domain/package.json
COPY packages/backend/package.json  packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN npm ci --workspace @home-guardian/frontend --workspace @home-guardian/domain --include-workspace-root

# ── build: Vite compila la SPA a dist/ ────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/domain   packages/domain
COPY packages/frontend packages/frontend
# El domain se compila primero: tsc del build necesita sus .d.ts para resolver
# @home-guardian/domain (igual que el backend).
# El cliente usa rutas relativas /api (VITE_API_URL vacío) → nginx hace proxy.
RUN npm run build -w @home-guardian/domain \
    && npm run build -w @home-guardian/frontend

# ── runtime: nginx sirve los estáticos y hace proxy /api ──────────────────────
FROM nginx:1.27-alpine AS runtime
# Plantilla: nginx reemplaza ${BACKEND_URL} al arrancar (envsubst integrado).
COPY packages/frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/packages/frontend/dist /usr/share/nginx/html

# Backend por defecto para compose; en Render se sobrescribe con la URL del servicio.
ENV BACKEND_URL=http://backend:3000
# Puerto de escucha. Render inyecta PORT; en compose se fija a 8080.
ENV PORT=8080
# Restringe envsubst a estas dos variables; así no toca las de nginx ($host, $uri…).
ENV NGINX_ENVSUBST_FILTER='BACKEND_URL|PORT'
EXPOSE 8080
# La imagen base de nginx procesa /etc/nginx/templates/*.template con envsubst.
