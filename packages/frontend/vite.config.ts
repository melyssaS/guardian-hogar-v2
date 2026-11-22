/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // En desarrollo y pruebas se usa el código fuente del dominio, sin recompilar.
    alias: {
      '@home-guardian/domain': fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/components/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
