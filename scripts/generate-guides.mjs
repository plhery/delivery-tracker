import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_LOCALES } from '../src/lib/locale.ts';
import { figureShape, GUIDE_SLUG, linkedGuides, parseGuide, typeset, wordCount } from '../src/guides/markdown.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = path.join(root, 'content', 'guides');
const outputPath = path.join(root, 'src', 'generated', 'guides.ts');

/** What a search result shows before it cuts the text. */
const LIMITS = { title: 60, description: [110, 165], words: 600, translated: [.6, 1.6] };

/**
 * Every guide in every language, read and checked: the list in `index.json`
 * names the guides in the order the site shows them, and each has one file per
 * language. A guide that would publish half-made stops the build here.
 */
export function readGuides(directory = contentRoot) {
  const ids = JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8'));
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('content/guides/index.json lists each guide once');
  // An id names the guide's screen in the analytics and its `guide:` links.
  for (const id of ids) if (typeof id !== 'string' || !GUIDE_SLUG.test(id)) throw new Error(`content/guides/index.json: ${JSON.stringify(id)} is not an id: lowercase letters, digits and hyphens`);
  const folders = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const folder of folders) if (!ids.includes(folder)) throw new Error(`content/guides/${folder} is not listed in index.json`);

  const guides = ids.map((id) => {
    const languages = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => {
      const file = path.join(directory, id, `${locale}.md`);
      const where = `content/guides/${id}/${locale}.md`;
      if (!existsSync(file)) throw new Error(`${where} is missing: a guide is written in every language`);
      const guide = parseGuide(readFileSync(file, 'utf8'), where);
      if (guide.title.length > LIMITS.title) throw new Error(`${where}: the title has ${guide.title.length} characters; a search result shows about ${LIMITS.title}`);
      const [shortest, longest] = LIMITS.description;
      if (guide.description.length < shortest || guide.description.length > longest) {
        throw new Error(`${where}: the description has ${guide.description.length} characters; write ${shortest} to ${longest}`);
      }
      if (guide.blocks.filter((block) => block.type === 'sources').length !== 1 || guide.blocks.at(-1).type !== 'sources') {
        throw new Error(`${where}: a guide ends with its ":::sources"`);
      }
      for (const linked of linkedGuides(guide.blocks)) {
        if (linked === id || !ids.includes(linked)) throw new Error(`${where}: "guide:${linked}" leads nowhere`);
      }
      return [locale, guide];
    }));
    const english = languages.en;
    const words = wordCount(english.blocks);
    if (words < LIMITS.words) throw new Error(`content/guides/${id}/en.md has ${words} words; a guide worth finding has at least ${LIMITS.words}`);
    for (const locale of SUPPORTED_LOCALES) {
      const where = `content/guides/${id}/${locale}.md`;
      const guide = languages[locale];
      if (figureShape(guide.blocks).join('\n') !== figureShape(english.blocks).join('\n')) {
        throw new Error(`${where}: its steps, journeys and numbers differ from the English guide's:\n${figureShape(guide.blocks).join('\n')}\n— against —\n${figureShape(english.blocks).join('\n')}`);
      }
      const ratio = wordCount(guide.blocks) / words;
      if (ratio < LIMITS.translated[0] || ratio > LIMITS.translated[1]) {
        throw new Error(`${where} has ${wordCount(guide.blocks)} words where the English guide has ${words}: a part is missing or doubled`);
      }
    }
    return { id, languages };
  });

  for (const locale of SUPPORTED_LOCALES) {
    const slugs = guides.map(({ languages }) => languages[locale].slug);
    const twice = slugs.find((slug, index) => slugs.indexOf(slug) !== index);
    if (twice) throw new Error(`Two ${locale} guides share the address "${twice}"`);
  }
  return guides;
}

/**
 * What the app needs of the guides without reading their files: where each one lives and what it is
 * called, set as its language sets it. A narrow no-break space is written as its escape, to be seen.
 */
export function guidesModule(guides) {
  const links = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
    locale,
    guides.map(({ id, languages }) => ({ id, slug: languages[locale].slug, title: typeset(languages[locale], locale).title })),
  ]));
  return `// Generated from content/guides by scripts/generate-guides.mjs. Do not edit.
import type { Locale } from '../lib/locale';

/** A guide in one language: its id in every language, and its address and title in this one. */
export interface GuideLink { id: string; slug: string; title: string }

export const GUIDE_LINKS: Record<Locale, readonly GuideLink[]> = ${JSON.stringify(links, null, 2).replace(/\u202f/g, '\\u202f')};
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = guidesModule(readGuides());
  if (process.argv.includes('--check')) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== expected) {
      throw new Error('src/generated/guides.ts is stale. Run npm run guides.');
    }
    console.log('The guides are complete and their list is current.');
  } else {
    writeFileSync(outputPath, expected);
    console.log(`Wrote ${path.relative(root, outputPath)}`);
  }
}
