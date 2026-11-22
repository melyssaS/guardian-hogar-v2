# Skill — Frontend (React + TypeScript + Vite)

## Fase MADA que aplica: CONSTRUIR y DEMOSTRAR

## Stack obligatorio
- React 18
- TypeScript 5
- Vite
- React Testing Library (pruebas de componentes)
- Playwright (pruebas E2E — prioritario)
- ESLint + Prettier

## Estructura
```
packages/frontend/
├── src/
│   ├── api/
│   │   └── client.ts       instancia única de fetch/axios + un objeto por recurso
│   ├── pages/              una página por ruta, mapea a una o más HU
│   ├── components/         componentes reutilizables
│   ├── hooks/              hooks personalizados para fetching y estado
│   └── types/              tipos TypeScript — usar @home-guardian/domain cuando aplique
├── tests/
│   ├── components/         React Testing Library
│   └── e2e/                Playwright
├── tsconfig.json
└── package.json
```

## Páginas y su HU
| Página | HU |
|--------|----|
| `SimulationPage.tsx` | HU-03, HU-04 |
| `RobotsPage.tsx` | HU-01, HU-09 |
| `RoomsPage.tsx` | HU-02 |
| `IncidentsPage.tsx` | HU-05, HU-06, HU-07, HU-08 |

## Convenciones — fase CONSTRUIR
- Solo componentes funcionales
- Prohibido usar `any` — tipar todo con TypeScript
- Un componente por archivo
- Todas las llamadas API van por `src/api/client.ts`
- Manejar estados de carga y error en cada página
- Usar tipos de `@home-guardian/domain` para contratos compartidos con el backend

## Pruebas — fase VERIFICAR
- **Vitest** para pruebas unitarias de componentes y hooks
- **React Testing Library** para lógica de componentes
- **Playwright** para pruebas E2E de humo — prioritario
- Pruebas E2E en `tests/e2e/` con un archivo por página

## HU reservadas — regla crítica
HU-06 a HU-10 NO se implementan en la línea base.
Dejar placeholder en el lugar exacto:
```tsx
{/* HU-06: filtrar por severidad — reservado para demo en vivo */}
{/* HU-07: exportar CSV — reservado para demo en vivo */}
{/* HU-08: conteos por tipo — reservado para demo en vivo */}
{/* HU-09: buscar por nombre — reservado para demo en vivo */}
{/* HU-10: advertencia batería baja — reservado para demo en vivo */}
```

## Lo que NO hacer
- No `any` en TypeScript
- No llamar al backend directamente desde componentes
- No credenciales en código fuente
- No implementar HU reservadas antes de la demo
