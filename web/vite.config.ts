import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
