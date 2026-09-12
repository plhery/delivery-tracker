import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type SchemaObject } from 'ajv';
import { describe, expect, it } from 'vitest';

const catalogDirectory = path.dirname(fileURLToPath(import.meta.url));
const carriersDirectory = path.resolve(catalogDirectory, '..', '..', 'carriers');
const schema: SchemaObject = JSON.parse(readFileSync(path.join(catalogDirectory, 'carrier.schema.json'), 'utf8'));

const folders = readdirSync(carriersDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function readCarrier(folder: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(carriersDirectory, folder, 'carrier.json'), 'utf8'));
}

describe('carrier.json', () => {
  const validate = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(schema);

  it('has at least one carrier folder', () => {
    expect(folders.length).toBeGreaterThan(0);
  });

  it.each(folders)('%s matches the carrier schema', (folder) => {
    const carrier = readCarrier(folder);
    const valid = validate(carrier);
    const errors = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    expect(errors ? `${folder}: ${errors}` : folder).toBe(folder);
    expect(valid).toBe(true);
  });

  it('names every carrier after its folder', () => {
    expect(folders.map((folder) => readCarrier(folder).id)).toEqual(folders);
  });

  it('keeps detection rule ids unique across the catalog', () => {
    const ids = folders.flatMap((folder) => {
      const detection = readCarrier(folder).detection as Array<{ id: string }>;
      return detection.map((rule) => rule.id);
    });
    expect([...new Set(ids)]).toHaveLength(ids.length);
  });
});
