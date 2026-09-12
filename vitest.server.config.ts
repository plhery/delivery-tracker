import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./src/test/serverOnly.ts', import.meta.url)),
      '@carriers': fileURLToPath(new URL('./packages/carriers', import.meta.url)),
    },
  },
  test: {
    include: ['src/server/**/*.test.ts', 'packages/carriers/**/*.test.ts'],
    exclude: ['src/server/**/*.live.test.ts', 'packages/carriers/**/*.live.test.ts', '**/node_modules/**'],
    environment: 'node',
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/server',
      include: ['src/server/**/*.ts', 'packages/carriers/**/*.ts'],
      exclude: [
        'src/server/**/*.test.ts',
        'src/server/types.ts',
        'packages/carriers/**/*.test.ts',
        'packages/carriers/generated/**',
        'packages/carriers/scripts/**',
      ],
      // This separately gates the newly ported backend at its measured
      // baseline. Raise these floors as adapter and route coverage expands.
      thresholds: {
        statements: 39,
        branches: 34,
        functions: 39,
        lines: 42,
        'src/server/{api,auth,boundedFetch,carrierResult,rateLimit,runtime,trackingSync,validation}.ts': {
          statements: 71,
          branches: 61,
          functions: 79,
          lines: 74,
        },
      },
    },
  },
});
