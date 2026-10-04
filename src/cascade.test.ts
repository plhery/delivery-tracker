import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const source = join(__dirname);
/** The email's own page is no screen of the application: it loads its stylesheet itself. */
const ELSEWHERE = ['components/EmailOff.css'];

function stylesheets(directory: string): string[] {
  return readdirSync(join(source, directory), { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? stylesheets(join(directory, entry.name))
    : entry.name.endsWith('.css') ? [join(directory, entry.name)] : []);
}

it('lists every stylesheet of the application’s screens, so none arrives later and out of order', () => {
  const listed = [...readFileSync(join(source, 'cascade.ts'), 'utf8').matchAll(/^import '\.\/(.+\.css)';$/gm)].map((match) => match[1]);
  const written = ['components', 'peek'].flatMap(stylesheets).map((file) => relative('.', file)).filter((file) => !ELSEWHERE.includes(file));
  expect(new Set(listed).size).toBe(listed.length);
  expect([...listed].sort()).toEqual(written.sort());
});
