import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { guidesModule, readGuides } from './generate-guides.mjs';

const content = fileURLToPath(new URL('../content/guides', import.meta.url));
const generated = fileURLToPath(new URL('../src/generated/guides.ts', import.meta.url));

/** A copy of the guides to break in one place. */
function copy(change) {
  const directory = mkdtempSync(path.join(tmpdir(), 'guides-'));
  cpSync(content, directory, { recursive: true });
  const [first] = JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8'));
  const file = (locale) => path.join(directory, first, `${locale}.md`);
  change({ directory, first, file, edit: (locale, from, to) => writeFileSync(file(locale), readFileSync(file(locale), 'utf8').replace(from, to)) });
  return directory;
}

function refuses(change, message) {
  const directory = copy(change);
  try {
    assert.throws(() => readGuides(directory), message);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('every guide is complete in every language, and the list the app links is current', () => {
  assert.equal(readFileSync(generated, 'utf8'), guidesModule(readGuides()), 'src/generated/guides.ts is stale. Run npm run guides.');
});

test('every guide has a picture', async () => {
  const scenes = readFileSync(fileURLToPath(new URL('../src/guides/scenes.tsx', import.meta.url)), 'utf8');
  for (const { id } of readGuides()) assert.match(scenes, new RegExp(`['"]?${id}['"]?: \\{ tone:`), `src/guides/scenes.tsx draws no picture for ${id}`);
});

test('a guide missing in one language is refused', () => {
  refuses(({ file }) => rmSync(file('pl')), /pl\.md is missing/);
});

test('a translation that lost its steps or half its text is refused', () => {
  refuses(({ edit }) => edit('fr', /:::steps[\s\S]*?:::\n/, ''), /differ from the English guide/);
  refuses(({ file }) => {
    const [head, body] = readFileSync(file('de'), 'utf8').split(/\n---\n/);
    const blocks = body.trim().split(/\n\n/);
    writeFileSync(file('de'), `${head}\n---\n\n${blocks[0]}\n\n${blocks.at(-1)}\n`);
  }, /differ from the English guide|a part is missing/);
});

test('a link to a guide that does not exist, a shared address and a long title are refused', () => {
  refuses(({ edit }) => edit('en', /\n## /, '\nSee [this](guide:no-such-guide).\n\n## '), /guide:no-such-guide" leads nowhere/);
  refuses(({ directory, edit }) => {
    const [, second] = JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8'));
    const slug = /^slug: (.+)$/m.exec(readFileSync(path.join(directory, second, 'it.md'), 'utf8'))[1];
    edit('it', /^slug: .+$/m, `slug: ${slug}`);
  }, /Two it guides share the address/);
  refuses(({ edit }) => edit('es', /^title: .+$/m, `title: ${'largo '.repeat(14)}`), /the title has 83 characters/);
});

test('a folder the list does not name, and an id that is no slug, are refused', () => {
  refuses(({ directory, first }) => cpSync(path.join(directory, first), path.join(directory, 'unlisted'), { recursive: true }), /unlisted is not listed/);
  refuses(({ directory, first }) => {
    renameSync(path.join(directory, first), path.join(directory, 'Bad_Id'));
    const index = path.join(directory, 'index.json');
    writeFileSync(index, readFileSync(index, 'utf8').replace(`"${first}"`, '"Bad_Id"'));
  }, /"Bad_Id" is not an id/);
});

test('French titles are listed as French guides are set, the narrow space written as its escape', () => {
  const directory = copy(({ edit }) => edit('fr', /^title: (.+)$/m, 'title: $1 ?'));
  try {
    const written = guidesModule(readGuides(directory));
    assert.match(written, /\\u202f\?"/);
    assert.doesNotMatch(written, /\u202f/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
