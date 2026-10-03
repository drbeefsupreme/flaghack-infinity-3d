import { defineConfig } from 'vitest/config';

/**
 * `npm run dev` pages reach a local `npm run host` through the dev server's own origin. Same values
 * as INFO_PATH, WS_PATH and DEFAULT_PORT in src/net/protocol.ts (not imported: Vite's config loader
 * wants config imports with file extensions, the sources have none).
 */
const LOCAL_HOST = 'http://127.0.0.1:8787';

export default defineConfig(({ isSsrBuild }) => ({
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': LOCAL_HOST,
      '/ws': { target: LOCAL_HOST, ws: true },
    },
  },
  // `vite build --ssr server/main.ts` bundles the multiplayer host for plain node into
  // dist-server/ (dependencies such as ws stay external and load from node_modules).
  build: isSsrBuild
    ? { target: 'node20', outDir: 'dist-server', sourcemap: true, copyPublicDir: false }
    : { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
}));
