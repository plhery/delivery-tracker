import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The site's documents, each written in Markdown at the repository's root and published
 * as a page of its own: `npm run privacy` writes the privacy notice, `npm run support` the
 * help page. Only the notice says since when it applies.
 */
export const PAGES = {
  privacy: { source: 'PRIVACY.md', output: 'public/privacy.html', title: 'Privacy — Peek', heading: 'Privacy notice', dated: true },
  support: { source: 'SUPPORT.md', output: 'public/support.html', title: 'Help — Peek', heading: 'Help', dated: false },
};

function escaped(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * One block's text: code, bold and links. Anything else Markdown would style is refused.
 * An address is a `mailto:` link in the document and never appears in the page: it is served
 * scrambled, a script writes it back as a link, and without scripts it reads "name at domain".
 */
function inlineHtml(text, source, scrambled) {
  const html = escaped(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(mailto:([^\s)]+)\)/g, (link, label, address) => {
      if (label !== address) throw new Error(`${source} must show an address as its own link: ${label}`);
      return `<a data-mail="${scrambled(address)}">${address.replace('@', ' at ')}</a>`;
    })
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  const plain = html.replace(/<a (?:href|data-mail)="[^"]*">/g, '');
  if (/[`*_[\]]/.test(plain)) throw new Error(`${source} uses Markdown the page cannot show: ${text}`);
  if (/\S@\S+\.\S/.test(plain)) throw new Error(`${source} must write an address as a mailto link, so the page can scramble it: ${text}`);
  return html;
}

/**
 * A document's Markdown as its page's blocks. It knows what the documents use: the title,
 * the notice's effective date, `##` headings, paragraphs, `- ` lists and a closing `> ` note.
 */
export function pageBlocks({ source, dated }, markdown, scrambled) {
  const inline = (text) => inlineHtml(text, source, scrambled);
  const blocks = [];
  let titled = false;
  for (const chunk of markdown.trim().split(/\n{2,}/)) {
    const lines = chunk.split('\n');
    const joined = (strip = /^/) => lines.map((line) => line.replace(strip, '').trim()).join(' ');
    if (!titled) {
      if (!/^# \S/.test(chunk) || lines.length !== 1) throw new Error(`${source} must start with its title`);
      titled = true;
    } else if (dated && /^Effective: /.test(chunk)) {
      blocks.push(`<p class="effective">${inline(joined().replace(':', ''))}</p>`);
    } else if (/^## \S/.test(chunk) && lines.length === 1) {
      blocks.push(`<h2>${inline(chunk.slice(3))}</h2>`);
    } else if (lines.every((line) => /^(- | {2})\S/.test(line)) && chunk.startsWith('- ')) {
      const items = chunk.split(/\n(?=- )/).map((item) => item.slice(2).split('\n').map((line) => line.trim()).join(' '));
      blocks.push(['<ul>', ...items.map((item) => `  <li>${inline(item)}</li>`), '</ul>'].join('\n'));
    } else if (lines.every((line) => /^> \S/.test(line))) {
      blocks.push(`<p class="forks">${inline(joined(/^> /))}</p>`);
    } else if (lines.every((line) => /^[^\s#>|-]/.test(line) && !/^\d+\. /.test(line))) {
      blocks.push(`<p>${inline(joined())}</p>`);
    } else {
      throw new Error(`${source} uses Markdown the page cannot show: ${lines[0]}`);
    }
  }
  if (!titled) throw new Error(`${source} must start with its title`);
  return blocks;
}

/**
 * The page a reader opens: the document inside the site's own frame, under the page's own
 * heading, with the two scripts the site's content policy allows by their hash.
 */
export function pageHtml(page, markdown, { appearanceScript, mailScript, scrambled }) {
  const indented = pageBlocks(page, markdown, scrambled).map((block) => block.split('\n').map((line) => `      ${line}`).join('\n'));
  return `<!doctype html>
<!-- Generated from ${page.source} by scripts/generate-privacy.mjs. Do not edit. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#F4F5F1" />
    <meta name="robots" content="index,follow" />
    <title>${escaped(page.title)}</title>
    <script>${appearanceScript}</script>
    <link rel="stylesheet" href="/privacy.css" />
  </head>
  <body>
    <main>
      <a class="back" href="/">← Back to Peek</a>
      <p class="eyebrow">Peek · Universal Parcel Tracker</p>
      <h1>${escaped(page.heading)}</h1>
${indented.join('\n')}
    </main>
    <script>${mailScript}</script>
  </body>
</html>
`;
}

/** A page as its document describes it now, with the site's own scripts. */
export async function currentPage(name) {
  const { APPEARANCE_BOOTSTRAP } = await import('../src/lib/appearanceConfig.ts');
  const { MAIL_LINK_BOOTSTRAP, scrambledAddress } = await import('../src/lib/mailLinkConfig.ts');
  return pageHtml(PAGES[name], readFileSync(path.join(root, PAGES[name].source), 'utf8'), {
    appearanceScript: APPEARANCE_BOOTSTRAP, mailScript: MAIL_LINK_BOOTSTRAP, scrambled: scrambledAddress,
  });
}

// `privacy` or `support` names the page to write; without a name, both are. `--check` writes nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2).filter((argument) => argument !== '--check');
  const unknown = names.find((name) => !Object.hasOwn(PAGES, name));
  if (unknown) throw new Error(`No page is called ${unknown}. Choose ${Object.keys(PAGES).join(' or ')}.`);
  for (const name of names.length > 0 ? names : Object.keys(PAGES)) {
    const { output } = PAGES[name];
    const expected = await currentPage(name);
    if (process.argv.includes('--check')) {
      if (readFileSync(path.join(root, output), 'utf8') !== expected) {
        throw new Error(`${output} is stale. Run npm run ${name}.`);
      }
      console.log(`${output} is current.`);
    } else {
      writeFileSync(path.join(root, output), expected);
      console.log(`Wrote ${output}`);
    }
  }
}
