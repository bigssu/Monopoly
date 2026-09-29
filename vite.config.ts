import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
