import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { currentPage, pageBlocks, pageHtml, PAGES } from './generate-privacy.mjs';

const published = (name) => readFileSync(fileURLToPath(new URL(`../${PAGES[name].output}`, import.meta.url)), 'utf8');
const scrambled = (address) => `scrambled-${address.length}`;

for (const [name, { source, output }] of Object.entries(PAGES)) {
  test(`${output} is what ${source} says`, async () => {
    assert.equal(published(name), await currentPage(name), `${output} is stale. Run npm run ${name}.`);
  });

  test(`${output} serves no address`, () => {
    assert.equal(/[\w.+-]@[\w-]+\.\w|href="mailto:/.test(published(name)), false);
  });
}

test('the help page says where to write', () => {
  assert.match(published('support'), /<a data-mail="[0-9a-f]+">hello at peektracker\.com<\/a>/);
});

test('a document becomes the blocks of its page', () => {
  const blocks = pageBlocks(PAGES.privacy, [
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

test('only the notice has an effective date', () => {
  const markdown = '# Title\n\nEffective: at once, in most cases.';
  assert.deepEqual(pageBlocks(PAGES.privacy, markdown, scrambled), ['<p class="effective">Effective at once, in most cases.</p>']);
  assert.deepEqual(pageBlocks(PAGES.support, markdown, scrambled), ['<p>Effective: at once, in most cases.</p>']);
});

test('each page frames its document under its own heading and carries the two scripts as given', () => {
  const frame = (name) => pageHtml(PAGES[name], '# Title\n\nOne paragraph.', { appearanceScript: 'appearance()', mailScript: 'addresses()', scrambled });
  const privacy = frame('privacy');
  assert.match(privacy, /^<!doctype html>\n<!-- Generated from PRIVACY\.md/);
  assert.match(privacy, /<title>Privacy — Peek<\/title>\n {4}<script>appearance\(\)<\/script>/);
  assert.match(privacy, /<h1>Privacy notice<\/h1>\n {6}<p>One paragraph\.<\/p>\n {4}<\/main>\n {4}<script>addresses\(\)<\/script>\n {2}<\/body>/);
  const support = frame('support');
  assert.match(support, /^<!doctype html>\n<!-- Generated from SUPPORT\.md/);
  assert.match(support, /<title>Help — Peek<\/title>\n {4}<script>appearance\(\)<\/script>/);
  assert.match(support, /<h1>Help<\/h1>\n {6}<p>One paragraph\.<\/p>\n {4}<\/main>\n {4}<script>addresses\(\)<\/script>\n {2}<\/body>/);
});

test('Markdown a page cannot show is refused, naming its document', () => {
  for (const page of Object.values(PAGES)) {
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
    ]) assert.throws(() => pageBlocks(page, markdown, scrambled), new RegExp(`^Error: ${page.source.replace('.', '\\.')} `), markdown);
  }
});
