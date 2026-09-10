// Produce a self-contained Dockerfile for Coolify's Dockerfile application type.
// Source remains reviewable here; Coolify stores the generated build definition.
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(name, import.meta.url));
const base = read('Dockerfile').toString().split('\n')[0];
const capture = read('tracking-capture.mjs').toString('base64');
const install = read('install.mjs').toString('base64');
console.log(`${base}
RUN printf '%s' '${capture}' | base64 -d > /app/packages/tiers/src/utils/tracking-capture.mjs \\
 && printf '%s' '${install}' | base64 -d > /tmp/install-tracking-capture.mjs \\
 && bun /tmp/install-tracking-capture.mjs && rm /tmp/install-tracking-capture.mjs`);
