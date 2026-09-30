import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Runs only the live coverage probe; see coverage-probe.mjs.
export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('../../../src/test/serverOnly.ts', import.meta.url)),
      '@carriers': fileURLToPath(new URL('..', import.meta.url)),
    },
  },
  test: {
    include: ['packages/carriers/scripts/coverage-probe.run.ts'],
    environment: 'node',
    disableConsoleIntercept: true,
  },
});
