/*
 * Regenerates contracts/fixtures/detection-golden.json: every number in the
 * corpus with the carrier, confidence and candidates the detection engine
 * returns for it. The native tests replay this file, so it has to come from the
 * engine itself rather than from a second implementation here.
 *
 * The engine is TypeScript with extensionless imports, which plain node cannot
 * resolve, so this script drives the sweep test in update mode. The writing
 * happens in core/testing/golden.ts.
 *
 *   node packages/carriers/scripts/detection-golden.mjs
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const result = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    '--config',
    'vitest.server.config.ts',
    'packages/carriers/core/testing/detectionSweep',
  ],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: { ...process.env, UPDATE_DETECTION_GOLDEN: '1' },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
