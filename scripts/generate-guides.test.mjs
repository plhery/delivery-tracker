import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CARRIER_CATALOG } from 'universal-parcel-scraper';
import { carriersModule, guidesModule, readCarriers, readGuides } from './generate-guides.mjs';

const content = fileURLToPath(new URL('../content/guides', import.meta.url));
const generated = fileURLToPath(new URL('../src/generated/guides.ts', import.meta.url));
const carrierContent = fileURLToPath(new URL('../content/carriers', import.meta.url));
const carriersGenerated = fileURLToPath(new URL('../src/generated/carriers.ts', import.meta.url));

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

test('a translation whose drawings differ from the English guide’s, or that lost most of its text, is refused', () => {
  refuses(({ edit }) => edit('fr', /^:::sources$/m, ':::steps\n- Une | Deux\n:::\n\n:::sources'), /differ from the English guide/);
  refuses(({ file }) => {
    const [head, body] = readFileSync(file('de'), 'utf8').split(/\n---\n/);
    const [lead] = body.trim().split(/\n\n/);
    writeFileSync(file('de'), `${head}\n---\n\n${lead}\n\n:::sources\n- [Quelle](https://source.example/)\n:::\n`);
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

test('a guide links a carrier’s page only in a language the carrier is written in', () => {
  const carriers = [{ id: 'some-carrier', languages: ['en', 'fr'] }];
  const directory = copy(({ edit }) => {
    edit('en', /\n## /, '\nAsk [the carrier](carrier:some-carrier).\n\n## ');
    edit('fr', /\n## /, '\nDemande au [transporteur](carrier:some-carrier).\n\n## ');
  });
  try {
    assert.equal(readGuides(directory, carriers).length, JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8')).length);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const refusesWith = (change, message) => {
    const broken = copy(change);
    try {
      assert.throws(() => readGuides(broken, carriers), message);
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  };
  refusesWith(({ edit }) => edit('de', /\n## /, '\nFrag den [Paketdienst](carrier:some-carrier).\n\n## '), /de\.md: "carrier:some-carrier" leads to no carrier's page in this language/);
  refusesWith(({ edit }) => edit('en', /\n## /, '\nAsk [nobody](carrier:no-such-carrier).\n\n## '), /en\.md: "carrier:no-such-carrier" leads to no carrier's page/);
});

test('French titles are listed as French guides are set, the no-break spaces written as their escapes', () => {
  const directory = copy(({ edit }) => edit('fr', /^title: .+$/m, 'title: Colis : où est-il ?'));
  try {
    const written = guidesModule(readGuides(directory));
    assert.match(written, /Colis\\u00a0: où est-il\\u202f\?"/);
    assert.doesNotMatch(written, /[\u202f\u00a0]/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** The carriers' list as the site has it. */
const carrierIndex = () => JSON.parse(readFileSync(path.join(carrierContent, 'index.json'), 'utf8'));

/** A copy of the carriers' pages to break in one place. */
function copyCarriers(change) {
  const directory = mkdtempSync(path.join(tmpdir(), 'carriers-'));
  cpSync(carrierContent, directory, { recursive: true });
  const indexFile = path.join(directory, 'index.json');
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const file = (id, locale) => path.join(directory, id, `${locale}.md`);
  change({
    directory, index, first: index[0], file,
    edit: (id, locale, from, to) => writeFileSync(file(id, locale), readFileSync(file(id, locale), 'utf8').replace(from, to)),
    list: (entries) => writeFileSync(indexFile, JSON.stringify(entries)),
  });
  return directory;
}

function refusesCarriers(change, message) {
  const directory = copyCarriers(change);
  try {
    assert.throws(() => readCarriers(directory), message);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** A page whose questions' section holds these questions and answers instead of its own. */
function asking(source, ...questions) {
  const start = source.lastIndexOf('\n## ');
  const heading = source.slice(start, source.indexOf('\n', start + 1));
  return `${source.slice(0, start)}${heading}\n\n${questions.join('\n\n')}\n${source.slice(source.indexOf('\n:::sources'))}`;
}

test('every carrier’s page is complete in its languages, and the list the app links is current', () => {
  assert.equal(readFileSync(carriersGenerated, 'utf8'), carriersModule(readCarriers()), 'src/generated/carriers.ts is stale. Run npm run guides.');
});

test('the carriers’ list names each once, by an id, under a carrier of the scraper’s catalog, in English and other languages of the site', () => {
  refusesCarriers(({ index, list }) => list([...index, index[0]]), /lists each carrier once/);
  refusesCarriers(({ index, first, list }) => list([{ ...first, id: 'Bad_Id' }, ...index.slice(1)]), /"Bad_Id" is not an id/);
  refusesCarriers(({ index, first, list }) => list([{ ...first, catalog: 'no-such-carrier' }, ...index.slice(1)]), /"no-such-carrier" is no carrier of Universal Parcel Scraper's catalog/);
  refusesCarriers(({ index, first, list }) => list([{ ...first, name: ' ' }, ...index.slice(1)]), /has no name/);
  refusesCarriers(({ index, first, list }) => list([{ ...first, colour: 'red' }, ...index.slice(1)]), /is a carrier's id, catalog, name and languages/);
  const [{ languages: written }] = carrierIndex();
  for (const languages of [written.filter((locale) => locale !== 'en'), [...written, 'nl'], [...written, 'en']]) {
    refusesCarriers(({ index, first: carrier, list }) => list([{ ...carrier, languages }, ...index.slice(1)]), /is written in English and in other languages of the site/);
  }
});

test('a page the list names is there, and nothing it does not name is', () => {
  refusesCarriers(({ first: carrier, file }) => rmSync(file(carrier.id, 'en')), /en\.md is missing: index\.json lists/);
  const unlisted = ['de', 'fr', 'it', 'es', 'pt', 'pl'].find((locale) => !carrierIndex()[0].languages.includes(locale));
  refusesCarriers(({ first: carrier, file }) => cpSync(file(carrier.id, 'en'), file(carrier.id, unlisted)), new RegExp(`${unlisted}\\.md is not one of the languages index\\.json lists`));
  refusesCarriers(({ first: carrier, file }) => writeFileSync(path.join(path.dirname(file(carrier.id, 'en')), 'notes.txt'), 'notes'), /notes\.txt is not one of the languages/);
  refusesCarriers(({ directory, first: carrier }) => cpSync(path.join(directory, carrier.id), path.join(directory, 'unlisted'), { recursive: true }), /content\/carriers\/unlisted is not listed in index\.json/);
  refusesCarriers(({ directory }) => writeFileSync(path.join(directory, 'draft.md'), 'A draft.'), /content\/carriers\/draft\.md is not listed/);
  // What a Mac leaves in a folder is no page.
  const directory = copyCarriers(({ directory: copied, first: carrier }) => {
    writeFileSync(path.join(copied, '.DS_Store'), '');
    writeFileSync(path.join(copied, carrier.id, '.DS_Store'), '');
  });
  try {
    assert.equal(readCarriers(directory).length, carrierIndex().length);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a page with a long title, a short description, or its sources anywhere but last is refused', () => {
  refusesCarriers(({ first: carrier, edit }) => edit(carrier.id, 'en', /^title: .+$/m, `title: ${'long '.repeat(13)}`), /the title has 64 characters/);
  refusesCarriers(({ first: carrier, edit }) => edit(carrier.id, 'en', /^description: .+$/m, 'description: Too short.'), /the description has 10 characters; write 110 to 165/);
  refusesCarriers(({ first: carrier, edit }) => edit(carrier.id, 'en', /\n:::sources\n/, '\n:::sources\n- [Twice](https://source.example/)\n:::\n\n:::sources\n'), /a carrier page ends with its ":::sources"/);
  refusesCarriers(({ first: carrier, file }) => writeFileSync(file(carrier.id, 'en'), `${readFileSync(file(carrier.id, 'en'), 'utf8').trimEnd()}\n\nA last word.\n`), /a carrier page ends with its ":::sources"/);
});

test('a page asks 3 to 5 questions in its last section, each ending with "?" and answered below it', () => {
  const ask = (...questions) => ({ first: carrier, file }) => writeFileSync(file(carrier.id, 'en'), asking(readFileSync(file(carrier.id, 'en'), 'utf8'), ...questions));
  const question = (number) => `### Question ${number}?\n\nAnswer ${number}.`;
  refusesCarriers(ask(question(1), question(2)), /its last section asks 2 questions, each a "### " heading; ask 3 to 5/);
  refusesCarriers(ask(...[1, 2, 3, 4, 5, 6].map(question)), /asks 6 questions/);
  refusesCarriers(ask(question(1), question(2), '### A statement.\n\nAn answer.'), /"A statement\." stands among the questions, and ends with "\?"/);
  refusesCarriers(ask(question(1), question(2), '### Who answers?', question(4)), /"Who answers\?" has no answer below it/);
  // A section with no question at all asks none.
  refusesCarriers(ask('Only a paragraph.'), /asks 0 questions/);
});

test('a page links a guide, or another carrier’s page in its own language, and nothing else', () => {
  const link = (target) => ({ first: carrier, edit }) => edit(carrier.id, 'en', /\n## /, `\nSee [this](${target}).\n\n## `);
  refusesCarriers(link('guide:no-such-guide'), /en\.md: "guide:no-such-guide" leads nowhere/);
  refusesCarriers(link(`carrier:${carrierIndex()[0].id}`), new RegExp(`en\\.md: "carrier:${carrierIndex()[0].id}" leads to no other carrier's page in this language`));
  refusesCarriers(link('carrier:no-such-carrier'), /"carrier:no-such-carrier" leads to no other carrier's page/);
  // A carrier written in a language another carrier is not.
  const index = carrierIndex();
  const [from, locale, to] = index.flatMap((carrier) => carrier.languages.flatMap((language) => index
    .filter((other) => !other.languages.includes(language)).map((other) => [carrier, language, other]))).at(0);
  refusesCarriers(({ edit }) => edit(from.id, locale, /\n## /, `\n[${to.name}](carrier:${to.id}).\n\n## `), new RegExp(`${from.id}/${locale}\\.md: "carrier:${to.id}" leads to no other carrier's page in this language`));
});

test('an English page has 600 words, a translation about as many, and two pages of a language never one address', () => {
  refusesCarriers(({ first: carrier, file }) => {
    const source = readFileSync(file(carrier.id, 'en'), 'utf8');
    const head = source.slice(0, source.indexOf('\n---\n') + 5);
    writeFileSync(file(carrier.id, 'en'), `${head}\nA short lead.\n\n## Questions\n\n### One?\n\nYes.\n\n### Two?\n\nYes.\n\n### Three?\n\nYes.\n\n:::sources\n- [Source](https://source.example/)\n:::\n`);
  }, /en\.md has \d+ words; a page worth finding has at least 600/);
  const translatedCarrier = carrierIndex().find(({ languages }) => languages.length > 1);
  const locale = translatedCarrier.languages.find((language) => language !== 'en');
  refusesCarriers(({ edit }) => edit(translatedCarrier.id, locale, /\n## /, `\n${'Wort '.repeat(1500)}\n\n## `), new RegExp(`${locale}\\.md has \\d+ words where the English page has \\d+: a part is missing or doubled`));
  refusesCarriers(({ index, edit }) => {
    const slug = /^slug: (.+)$/m.exec(readFileSync(path.join(carrierContent, index[0].id, 'en.md'), 'utf8'))[1];
    edit(index[1].id, 'en', /^slug: .+$/m, `slug: ${slug}`);
  }, /Two en carrier pages share the address/);
});

test('the list the app links holds, in each language, its carriers in order with their name and brand colour, French titles set as French is', () => {
  const directory = copyCarriers(({ index, first: carrier, file, list }) => {
    if (!carrier.languages.includes('fr')) {
      list([{ ...carrier, languages: [...carrier.languages, 'fr'] }, ...index.slice(1)]);
      // The English page as a French one, without its links to carriers that have no French page.
      writeFileSync(file(carrier.id, 'fr'), readFileSync(file(carrier.id, 'en'), 'utf8').replace(/\[([^\]]+)\]\(carrier:[^)]+\)/g, '$1'));
    }
    writeFileSync(file(carrier.id, 'fr'), readFileSync(file(carrier.id, 'fr'), 'utf8').replace(/^title: .+$/m, 'title: Colis : où est-il ?').replace(/^slug: .+$/m, 'slug: colis-ou-est-il'));
  });
  try {
    const index = JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8'));
    const written = carriersModule(readCarriers(directory));
    assert.match(written, /"title": "Colis\\u00a0: où est-il\\u202f\?"/);
    assert.doesNotMatch(written, /[  ]/);
    const links = JSON.parse(written.slice(written.indexOf('= {') + 2, written.lastIndexOf(';')));
    for (const locale of ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl']) {
      const listed = index.filter(({ languages }) => languages.includes(locale));
      assert.deepEqual(links[locale].map(({ id, name, color }) => ({ id, name, color })), listed.map(({ id, name, catalog }) => ({ id, name, color: CARRIER_CATALOG[catalog].color })), locale);
      for (const link of links[locale]) assert.match(link.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
    assert.equal(links.fr[0].slug, 'colis-ou-est-il');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
