import { describe, expect, it } from 'vitest';
import { anchorOf, figureShape, frenchSpacing, linkedGuides, parseBlocks, parseGuide, parseInline, plainText, typeset, wordCount } from './markdown';

const head = ['---', 'title: Where is my parcel?', 'description: What a parcel does between two scans.', 'slug: where-is-my-parcel',
  'picture: Pip looks at a map.', 'published: 2026-01-05', 'updated: 2026-02-01', '---', ''].join('\n');

describe('a guide’s Markdown', () => {
  it('reads what stands above the text, then the text as blocks', () => {
    const guide = parseGuide(`${head}\nThe lead says it in **one** line\nover two.\n\n## Où est-il ?\n\nA paragraph.\n`);
    expect(guide).toMatchObject({ title: 'Where is my parcel?', slug: 'where-is-my-parcel', published: '2026-01-05', updated: '2026-02-01' });
    expect(guide.blocks).toEqual([
      { type: 'paragraph', text: [{ type: 'text', text: 'The lead says it in ' }, { type: 'strong', children: [{ type: 'text', text: 'one' }] }, { type: 'text', text: ' line over two.' }] },
      { type: 'heading', level: 2, id: 'ou-est-il', plain: 'Où est-il ?', text: [{ type: 'text', text: 'Où est-il ?' }] },
      { type: 'paragraph', text: [{ type: 'text', text: 'A paragraph.' }] },
    ]);
  });

  it('refuses a file without its head, an unknown or doubled field, a bad slug or date, and a guide that opens with a heading', () => {
    expect(() => parseGuide('No head.')).toThrow(/starts with its title/);
    expect(() => parseGuide(head.replace('slug:', 'address:') + '\nText.')).toThrow(/"address: where-is-my-parcel" is not one of/);
    expect(() => parseGuide(head.replace('updated: 2026-02-01\n', 'updated: 2026-02-01\ntitle: Again\n') + '\nText.')).toThrow(/written once/);
    expect(() => parseGuide(head.replace('picture: Pip looks at a map.\n', '') + '\nText.')).toThrow(/"picture" is missing/);
    expect(() => parseGuide(head.replace('where-is-my-parcel', 'Where_Is') + '\nText.')).toThrow(/the slug is lowercase/);
    expect(() => parseGuide(head.replace('2026-02-01', '1 February') + '\nText.')).toThrow(/written 2026-01-31, not "1 February"/);
    for (const day of ['2026-02-30', '2026-04-31', '2025-02-29', '2026-13-01']) {
      expect(() => parseGuide(head.replace('2026-02-01', day) + '\nText.'), day).toThrow(/a date is a day of the calendar/);
    }
    expect(parseGuide(head.replace('2026-02-01', '2028-02-29') + '\nText.').updated).toBe('2028-02-29');
    expect(() => parseGuide(head.replace('2026-02-01', '2025-12-01') + '\nText.')).toThrow(/updated before it is published/);
    expect(() => parseGuide(`${head}\n## A heading first\n`)).toThrow(/opens with a paragraph/);
    expect(() => parseGuide(`${head}\n\n`)).toThrow(/has no text/);
  });

  it('reads bold, italics, code, links and escapes, and names what it cannot read', () => {
    expect(parseInline('Say *hi* to `1Z 999` at [the post](https://post.example/a_b), [Peek](/) or [customs](guide:customs): 2 \\* 3 \\| 4.')).toEqual([
      { type: 'text', text: 'Say ' }, { type: 'em', children: [{ type: 'text', text: 'hi' }] }, { type: 'text', text: ' to ' },
      { type: 'code', text: '1Z 999' }, { type: 'text', text: ' at ' },
      { type: 'link', href: 'https://post.example/a_b', children: [{ type: 'text', text: 'the post' }] }, { type: 'text', text: ', ' },
      { type: 'link', href: '/', children: [{ type: 'text', text: 'Peek' }] }, { type: 'text', text: ' or ' },
      { type: 'guide', id: 'customs', children: [{ type: 'text', text: 'customs' }] }, { type: 'text', text: ': 2 * 3 | 4.' },
    ]);
    expect(plainText(parseInline('A **bold [link](https://a.example)** and `code`'))).toBe('A bold link and code');
    expect(() => parseInline('An *open italic')).toThrow(/"\*" is missing/);
    expect(() => parseInline('An **open bold')).toThrow(/"\*\*" is missing/);
    expect(() => parseInline('Some `open code')).toThrow(/code is not closed/);
    expect(() => parseInline('A [link](http://plain.example)')).toThrow(/leads to an https address/);
    expect(() => parseInline('A [link](https://a.example')).toThrow(/a link is not closed/);
    expect(() => parseInline('A [guide](guide:Not A Guide)')).toThrow(/does not name a guide/);
    expect(() => parseInline('A stray ] bracket')).toThrow(/needs a backslash/);
    expect(() => parseInline('Empty **** bold')).toThrow(/bold text is empty/);
    expect(() => parseInline('')).toThrow(/text is empty/);
    expect(() => parseInline('![A map](https://a.example/map.png)')).toThrow(/holds no images/);
    expect(parseInline('Yes\\![a link](https://a.example)')).toEqual([{ type: 'text', text: 'Yes!' }, { type: 'link', href: 'https://a.example', children: [{ type: 'text', text: 'a link' }] }]);
  });

  it('reads lists, notes and tables', () => {
    expect(parseBlocks('- One\n  goes on\n- Two\n\n1. First\n2. Second\n\n> A note\n> on two lines.\n\n| Carrier | Format |\n| --- | :---: |\n| UPS | `1Z` \\| 18 |\n|  | empty |')).toEqual([
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'One goes on' }], [{ type: 'text', text: 'Two' }]] },
      { type: 'list', ordered: true, items: [[{ type: 'text', text: 'First' }], [{ type: 'text', text: 'Second' }]] },
      { type: 'note', text: [{ type: 'text', text: 'A note on two lines.' }] },
      {
        type: 'table',
        head: [[{ type: 'text', text: 'Carrier' }], [{ type: 'text', text: 'Format' }]],
        rows: [[[{ type: 'text', text: 'UPS' }], [{ type: 'code', text: '1Z' }, { type: 'text', text: ' | 18' }]], [[], [{ type: 'text', text: 'empty' }]]],
      },
    ]);
    expect(() => parseBlocks('- One\nnot indented')).toThrow(/a list cannot hold/);
    expect(() => parseBlocks('> A note\nthat stops')).toThrow(/every line of a note/);
    expect(() => parseBlocks('| A | B |\n| C | D |')).toThrow(/a table needs its heading/);
    expect(() => parseBlocks('| A | B |\n| --- | --- |\n| C |')).toThrow(/1 cells where its heading has 2/);
    expect(() => parseBlocks('| A | B |\n| --- | --- |\n| C | D')).toThrow(/starts and ends with/);
    expect(() => parseBlocks('# A title')).toThrow(/headings are "## " or "### "/);
    expect(() => parseBlocks('## A heading\nwith a line')).toThrow(/a heading stands alone/);
    expect(() => parseBlocks('A paragraph\n  with an indented line')).toThrow(/start at the margin/);
    // Markdown the guides do not use is refused, not published as something else.
    expect(() => parseBlocks('* One\n* Two')).toThrow(/items start with "- "/);
    expect(() => parseBlocks('+ One\n+ Two')).toThrow(/items start with "- "/);
    expect(() => parseBlocks('A paragraph\n* and a list')).toThrow(/items start with "- "/);
    for (const rule of ['---', '***', '___', 'A heading as a line\n---']) expect(() => parseBlocks(rule), rule).toThrow(/draws no lines/);
  });

  it('gives two headings of the same words different anchors', () => {
    const [first, second, third] = parseBlocks('## In transit\n\n### In transit\n\n## Zażółć: gęślą jaźń — Straße');
    expect([first, second, third].map((block) => block.type === 'heading' && block.id)).toEqual(['in-transit', 'in-transit-2', 'zazolc-gesla-jazn-strasse']);
    expect(anchorOf('¿…?')).toBe('');
  });

  it('reads steps, a number taken apart, a journey and the sources', () => {
    const blocks = parseBlocks([
      ':::steps', '- Label created | The carrier has **no parcel** yet.', '- Picked up | The first scan.', ':::', '',
      ':::anatomy RR 12345678 5 CH', '- RR | Registered', '- 12345678 | Serial', '', '- 5 | Check digit', '- CH | Switzerland', ':::', '',
      ':::journey', '- shop | Seller | Label', '- plane | Flight | No scans', '- home | You | Delivered', ':::', '',
      ':::sources', '- [UPU](https://www.upu.int/) – the standard', '- [Swiss Post](https://www.post.ch/)', ':::',
    ].join('\n'));
    expect(blocks.map((block) => block.type)).toEqual(['steps', 'anatomy', 'journey', 'sources']);
    expect(figureShape(blocks)).toEqual(['steps:2', 'anatomy:RR 12345678 5 CH', 'journey:shop,plane,home']);
    expect(blocks[0]).toMatchObject({ items: [{ title: [{ text: 'Label created' }], note: [{ text: 'The carrier has ' }, { type: 'strong' }, { text: ' yet.' }] }, {}] });
    expect(blocks[1]).toMatchObject({ parts: [{ text: 'RR' }, { text: '12345678' }, { text: '5' }, { text: 'CH', label: [{ text: 'Switzerland' }] }] });
    expect(blocks[3]).toMatchObject({ items: [[{ type: 'link', href: 'https://www.upu.int/' }, { text: ' – the standard' }], [{ type: 'link' }]] });
    expect(wordCount(blocks)).toBe(31);
  });

  it('refuses a drawing it does not know or cannot finish', () => {
    expect(() => parseBlocks(':::gallery\n- A\n:::')).toThrow(/there is no ":::gallery"/);
    for (const opening of [':::', ':::Steps', '::: steps', ':::steps:']) {
      expect(() => parseBlocks(`${opening}\n- A | B\n:::`, 'content/guides/x/en.md'), opening).toThrow(`content/guides/x/en.md: "${opening}" opens nothing`);
    }
    expect(() => parseBlocks('A paragraph.\n:::', 'content/guides/x/en.md')).toThrow('content/guides/x/en.md: ":::" opens nothing');
    expect(() => parseBlocks(':::steps\n- A | B')).toThrow(/not closed/);
    expect(() => parseBlocks(':::steps\n:::')).toThrow(/":::steps" is empty/);
    expect(() => parseBlocks(':::steps now\n- A | B\n:::')).toThrow(/takes nothing after its name/);
    expect(() => parseBlocks(':::steps\n- Only a title\n:::')).toThrow(/has 2 parts/);
    expect(() => parseBlocks(':::journey\n- rocket | Launch | Up\n:::')).toThrow(/no "rocket" stop/);
    expect(() => parseBlocks(':::anatomy RR 5 CH\n- RR | Registered\n- CH | Switzerland\n:::')).toThrow(/must name its parts in order/);
    expect(() => parseBlocks(':::sources\n- Not a link\n:::')).toThrow(/a source starts with its link/);
    expect(() => parseBlocks(':::sources\n- [A](https://a.example) | more\n:::')).toThrow(/a source is one line/);
  });

  it('finds the guides a guide links, wherever the link stands', () => {
    const blocks = parseBlocks('See [customs](guide:customs).\n\n- **[Statuses](guide:tracking-statuses)**\n\n| A |\n| --- |\n| [again](guide:customs) |\n\n:::steps\n- One | [Formats](guide:formats)\n:::');
    expect(linkedGuides(blocks)).toEqual(['customs', 'tracking-statuses', 'formats']);
  });
});

describe('a guide’s typography', () => {
  const narrow = String.fromCharCode(0x202f);

  it('sets a narrow no-break space where French takes one, in place of the plain space typed', () => {
    expect(frenchSpacing('Où est-il ? Le voilà ! Attends ; regarde : « ici ».')).toBe(
      `Où est-il${narrow}? Le voilà${narrow}! Attends${narrow}; regarde${narrow}: «${narrow}ici${narrow}».`,
    );
    // Nothing else moves: no space is added where none was typed, and other spaces stay.
    expect(frenchSpacing('À 10:30, «oui»: rien?')).toBe('À 10:30, «oui»: rien?');
  });

  it('sets a French guide’s words, and leaves its code and every other language as written', () => {
    const source = `${head.replace('title: Where is my parcel?', 'title: Où est mon colis ?')}\nLe statut dit « livré » : vérifie \`RR 123 : CH\` !\n\n## Et après ?\n\n| Statut | Sens |\n| --- | --- |\n| Livré | Fini ! |\n\n:::steps\n- Attends | Un jour ou deux ?\n:::\n`;
    const written = parseGuide(source);
    expect(typeset(written, 'de')).toBe(written);
    const french = typeset(written, 'fr');
    expect(french.title).toBe(`Où est mon colis${narrow}?`);
    expect(french.blocks[0]).toEqual({ type: 'paragraph', text: [
      { type: 'text', text: `Le statut dit «${narrow}livré${narrow}»${narrow}: vérifie ` },
      { type: 'code', text: 'RR 123 : CH' },
      { type: 'text', text: `${narrow}!` },
    ] });
    expect(french.blocks[1]).toMatchObject({ id: 'et-apres', plain: `Et après${narrow}?`, text: [{ type: 'text', text: `Et après${narrow}?` }] });
    expect(french.blocks[2]).toMatchObject({ rows: [[[{ text: 'Livré' }], [{ text: `Fini${narrow}!` }]]] });
    expect(french.blocks[3]).toMatchObject({ items: [{ note: [{ text: `Un jour ou deux${narrow}?` }] }] });
    // The written guide is left as it was read.
    expect(written.title).toBe('Où est mon colis ?');
  });
});
