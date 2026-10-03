import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'PRIVACY.md');
const outputPath = path.join(root, 'public', 'privacy.html');

function escaped(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** One block's text: code, bold and links. Anything else Markdown would style is refused. */
function inline(text) {
  const html = escaped(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2">$1</a>');
  const plain = html.replace(/<a href="[^"]*">/g, '');
  if (/[`*_[\]]/.test(plain)) throw new Error(`PRIVACY.md uses Markdown the page cannot show: ${text}`);
  return html;
}

/**
 * The notice's Markdown as the page's blocks. It knows what PRIVACY.md uses: the title,
 * the effective date, `##` headings, paragraphs, `- ` lists and a closing `> ` note.
 */
export function noticeBlocks(markdown) {
  const blocks = [];
  let titled = false;
  for (const chunk of markdown.trim().split(/\n{2,}/)) {
    const lines = chunk.split('\n');
    const joined = (strip = /^/) => lines.map((line) => line.replace(strip, '').trim()).join(' ');
    if (!titled) {
      if (!/^# \S/.test(chunk) || lines.length !== 1) throw new Error('PRIVACY.md must start with its title');
      titled = true;
    } else if (/^Effective: /.test(chunk)) {
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
      throw new Error(`PRIVACY.md uses Markdown the page cannot show: ${lines[0]}`);
    }
  }
  if (!titled) throw new Error('PRIVACY.md must start with its title');
  return blocks;
}

/**
 * The page the apps open: the notice inside the site's own frame. Cloudflare swaps an
 * address in a page for a script that writes it back, which the site's content policy
 * refuses, so a reader would see no address. The `email_off` comments tell it to leave
 * the notice as written.
 */
export function privacyPage(markdown, appearanceScript) {
  const indented = noticeBlocks(markdown).map((block) => block.split('\n').map((line) => `      ${line}`).join('\n'));
  return `<!doctype html>
<!-- Generated from PRIVACY.md by scripts/generate-privacy.mjs. Do not edit. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#F4F5F1" />
    <meta name="robots" content="index,follow" />
    <title>Privacy — Peek</title>
    <script>${appearanceScript}</script>
    <link rel="stylesheet" href="/privacy.css" />
  </head>
  <body>
    <main>
      <a class="back" href="/">← Back to Peek</a>
      <p class="eyebrow">Peek · Universal Parcel Tracker</p>
      <h1>Privacy notice</h1>
      <!--email_off-->
${indented.join('\n')}
      <!--/email_off-->
    </main>
  </body>
</html>
`;
}

/** The page as PRIVACY.md describes it now, with the script the site's content policy allows by its hash. */
export async function currentPrivacyPage() {
  const { APPEARANCE_BOOTSTRAP } = await import('../src/lib/appearanceConfig.ts');
  return privacyPage(readFileSync(sourcePath, 'utf8'), APPEARANCE_BOOTSTRAP);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = await currentPrivacyPage();
  if (process.argv.includes('--check')) {
    if (readFileSync(outputPath, 'utf8') !== expected) {
      throw new Error('public/privacy.html is stale. Run npm run privacy.');
    }
    console.log('The privacy page is current.');
  } else {
    writeFileSync(outputPath, expected);
    console.log(`Wrote ${path.relative(root, outputPath)}`);
  }
}
