// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Manifest = { version: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
const manifest = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Manifest;
const app = manifest('../../package.json');
const scraper = manifest('../../node_modules/universal-parcel-scraper/package.json');

describe('the scraper dependency', () => {
  it('is an exact release, and the one installed', () => {
    expect(app.dependencies?.['universal-parcel-scraper']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(scraper.version).toBe(app.dependencies?.['universal-parcel-scraper']);
  });

  // `.npmrc` sets legacy-peer-deps, so npm does not check the scraper's peers.
  it('comes with the transports it asks for, at its versions', () => {
    expect(app.dependencies).toMatchObject(scraper.peerDependencies ?? {});
  });
});
