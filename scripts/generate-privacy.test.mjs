import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { currentPrivacyPage, noticeBlocks, privacyPage } from './generate-privacy.mjs';

const published = fileURLToPath(new URL('../public/privacy.html', import.meta.url));
const scrambled = (address) => `scrambled-${address.length}`;

test('the published page is the notice in PRIVACY.md', async () => {
  assert.equal(readFileSync(published, 'utf8'), await currentPrivacyPage(), 'public/privacy.html is stale. Run npm run privacy.');
});

test('the published page serves no address', () => {
  assert.equal(/[\w.+-]@[\w-]+\.\w|href="mailto:/.test(readFileSync(published, 'utf8')), false);
});

test('the notice becomes the blocks of the page', () => {
  const blocks = noticeBlocks([
    '# Peek privacy notice',
    'Effective: 1 January 2030',
    'A first line\nand its second, with **Download my data** and `#`.',
    '## Emails & alerts',
    '- One item\n  that goes on\n- A [link](https://example.test/a_b) and <tags>',
    'Write to [hello@example.test](mailto:hello@example.test).',
    '> A closing note,\n> on two lines.',
  ].join('\n\n'), scrambled);
  assert.deepEqual(blocks, [
    '<p class="effective">Effective 1 January 2030</p>',
    '<p>A first line and its second, with <strong>Download my data</strong> and <code>#</code>.</p>',
    '<h2>Emails &amp; alerts</h2>',
    '<ul>\n  <li>One item that goes on</li>\n  <li>A <a href="https://example.test/a_b">link</a> and &lt;tags&gt;</li>\n</ul>',
    '<p>Write to <a data-mail="scrambled-18">hello at example.test</a>.</p>',
    '<p class="forks">A closing note, on two lines.</p>',
  ]);
});

test('the page frames the notice and carries its two scripts as given', () => {
  const page = privacyPage('# Title\n\nOne paragraph.', { appearanceScript: 'appearance()', mailScript: 'addresses()', scrambled });
  assert.match(page, /^<!doctype html>\n<!-- Generated from PRIVACY\.md/);
  assert.match(page, /<script>appearance\(\)<\/script>/);
  assert.match(page, /<h1>Privacy notice<\/h1>\n {6}<p>One paragraph\.<\/p>\n {4}<\/main>\n {4}<script>addresses\(\)<\/script>\n {2}<\/body>/);
});

test('Markdown the page cannot show is refused', () => {
  for (const markdown of [
    'No title',
    '# Title\n\n### A deeper heading',
    '# Title\n\n1. A numbered item',
    '# Title\n\n| a | table |',
    '# Title\n\nSome *emphasis* here',
    '# Title\n\nA [link](http://example.test) without TLS',
    '# Title\n\n- An item\nand a stray line',
    '# Title\n\nWrite to hello@example.test, not as a link',
    '# Title\n\n[Write to us](mailto:hello@example.test)',
  ]) assert.throws(() => noticeBlocks(markdown, scrambled), /PRIVACY\.md/, markdown);
});
