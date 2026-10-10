/**
 * A guide's Markdown as the blocks its page draws. It knows what the guides
 * use and refuses the rest, so a typo fails the check instead of reaching a
 * reader. `content/guides/README.md` describes the format for writers.
 *
 * This file imports nothing and uses only types Node can strip: the page, the
 * tests and `scripts/generate-guides.mjs` all read it.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  /** A page elsewhere, or Peek's own front page (`/`). */
  | { type: 'link'; href: string; children: Inline[] }
  /** Another guide, by its id: the page links the reader's own language. */
  | { type: 'guide'; id: string; children: Inline[] }
  /** A carrier's page, by its id: the page links the reader's own language, where the carrier has one. */
  | { type: 'carrier'; id: string; children: Inline[] };

/** The stops a journey can draw. */
export const JOURNEY_ICONS = ['shop', 'label', 'warehouse', 'truck', 'plane', 'ship', 'customs', 'handover', 'locker', 'home'] as const;
export type JourneyIcon = (typeof JOURNEY_ICONS)[number];

export type Block =
  | { type: 'heading'; level: 2 | 3; id: string; text: Inline[]; plain: string }
  | { type: 'paragraph'; text: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'note'; text: Inline[] }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] }
  /** Numbered steps, each a title and what it means. */
  | { type: 'steps'; items: { title: Inline[]; note: Inline[] }[] }
  /** A tracking number taken apart: each part and what it says. */
  | { type: 'anatomy'; parts: { text: string; label: Inline[] }[] }
  /** A parcel's way, stop by stop. */
  | { type: 'journey'; stops: { icon: JourneyIcon; title: Inline[]; note: Inline[] }[] }
  /** A field that names the carrier of a number as it is typed, and tracks it on the landing. */
  | { type: 'checker' }
  | { type: 'sources'; items: Inline[][] };

export interface Guide {
  title: string;
  description: string;
  slug: string;
  /** What the picture at the top shows, for readers who cannot see it. */
  picture: string;
  published: string;
  updated: string;
  blocks: Block[];
}

/** A carrier's page: a guide's text about one carrier, without a picture of its own. */
export type CarrierText = Omit<Guide, 'picture'>;

const FIELDS = ['title', 'description', 'slug', 'picture', 'published', 'updated'] as const;
type Field = (typeof FIELDS)[number];
const DIRECTIVES = ['steps', 'anatomy', 'journey', 'checker', 'sources'] as const;
type Directive = (typeof DIRECTIVES)[number];

export const GUIDE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a date is written `2026-01-31` and is a day of the calendar: Date.parse moves 2026-02-30 to March. */
function isDay(text: string): boolean {
  const time = Date.parse(`${text}T00:00:00Z`);
  return DAY.test(text) && !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === text;
}

/** The words of some inline text, without its marks. */
export function plainText(inline: readonly Inline[]): string {
  return inline.map((node) => (node.type === 'text' || node.type === 'code' ? node.text : plainText(node.children))).join('');
}

/** A heading as the end of an address: plain Latin letters, digits and hyphens. */
export function anchorOf(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/ł/g, 'l').replace(/ß/g, 'ss').replace(/[æ]/g, 'ae').replace(/[œ]/g, 'oe').replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function linkTarget(target: string, children: Inline[], where: string): Inline {
  for (const type of ['guide', 'carrier'] as const) {
    if (!target.startsWith(`${type}:`)) continue;
    const id = target.slice(type.length + 1);
    if (!GUIDE_SLUG.test(id)) throw new Error(`${where}: "${target}" does not name a ${type}`);
    return { type, id, children };
  }
  if (target !== '/' && !/^https:\/\/[^\s<>"]+$/.test(target)) {
    throw new Error(`${where}: a link leads to an https address, to "/", to "guide:<id>" or to "carrier:<id>", not "${target}"`);
  }
  return { type: 'link', href: target, children };
}

/**
 * One block's text: bold, italics, code and links. A backslash keeps the next
 * character as it is, so `\*` and `\|` can be written.
 */
export function parseInline(source: string, where = 'guide'): Inline[] {
  let at = 0;
  const fail = (message: string): never => { throw new Error(`${where}: ${message} in "${source}"`); };

  function until(close: string): Inline[] {
    const nodes: Inline[] = [];
    let text = '';
    const flush = () => { if (text) { nodes.push({ type: 'text', text }); text = ''; } };
    while (at < source.length) {
      if (close && source.startsWith(close, at)) { flush(); at += close.length; return nodes; }
      const char = source[at];
      if (char === '\\' && at + 1 < source.length) { text += source[at + 1]; at += 2; continue; }
      if (char === '`') {
        const end = source.indexOf('`', at + 1);
        if (end < 0) fail('code is not closed');
        flush();
        nodes.push({ type: 'code', text: source.slice(at + 1, end) });
        at = end + 1;
        continue;
      }
      if (source.startsWith('**', at)) {
        flush(); at += 2;
        const children = until('**');
        if (!children.length) fail('bold text is empty');
        nodes.push({ type: 'strong', children });
        continue;
      }
      if (char === '*') {
        flush(); at += 1;
        const children = until('*');
        if (!children.length) fail('italic text is empty');
        nodes.push({ type: 'em', children });
        continue;
      }
      if (char === '!' && source[at + 1] === '[') fail('a guide holds no images; a "!" before a link is written "\\!"');
      if (char === '[') {
        flush(); at += 1;
        const children = until('](');
        const end = source.indexOf(')', at);
        if (end < 0) fail('a link is not closed');
        nodes.push(linkTarget(source.slice(at, end), children, where));
        at = end + 1;
        continue;
      }
      if (char === ']') fail('"]" needs a backslash before it');
      text += char;
      at += 1;
    }
    if (close) fail(`"${close}" is missing`);
    flush();
    return nodes;
  }

  const nodes = until('');
  if (!nodes.length) fail('text is empty');
  return nodes;
}

/** A line cut at its `|`, leaving the ones written `\|` in place for the inline text. */
function cells(line: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\\' && index + 1 < line.length) { current += line[index] + line[index + 1]; index += 1; }
    else if (line[index] === '|') { parts.push(current.trim()); current = ''; }
    else current += line[index];
  }
  parts.push(current.trim());
  return parts;
}

/** A list's items: each starts at its mark, and goes on over the indented lines below it. */
function listItems(lines: string[], mark: RegExp, where: string): string[] {
  const items: string[] = [];
  for (const line of lines) {
    if (mark.test(line)) items.push(line.replace(mark, '').trim());
    else if (/^ {2,}\S/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`;
    else throw new Error(`${where}: a list cannot hold "${line}"`);
  }
  return items;
}

function directive(name: Directive, argument: string, lines: string[], where: string): Block {
  if (name === 'checker') {
    if (argument || lines.some((line) => line.trim())) throw new Error(`${where}: ":::checker" holds nothing: the field draws itself`);
    return { type: 'checker' };
  }
  const inline = (text: string) => parseInline(text, where);
  const rows = listItems(lines.filter((line) => line.trim()), /^- /, where).map(cells);
  if (!rows.length) throw new Error(`${where}: ":::${name}" is empty`);
  const sized = (size: number) => rows.forEach((row) => {
    if (row.length !== size || row.some((cell) => !cell)) throw new Error(`${where}: each line of ":::${name}" has ${size} parts, cut by "|": "${row.join(' | ')}"`);
  });
  if (name !== 'anatomy' && argument) throw new Error(`${where}: ":::${name}" takes nothing after its name`);
  switch (name) {
    case 'steps':
      sized(2);
      return { type: 'steps', items: rows.map(([title, note]) => ({ title: inline(title), note: inline(note) })) };
    case 'journey':
      sized(3);
      return {
        type: 'journey',
        stops: rows.map(([icon, title, note]) => {
          if (!JOURNEY_ICONS.includes(icon as JourneyIcon)) throw new Error(`${where}: a journey has no "${icon}" stop; it knows ${JOURNEY_ICONS.join(', ')}`);
          return { icon: icon as JourneyIcon, title: inline(title), note: inline(note) };
        }),
      };
    case 'anatomy': {
      sized(2);
      const written = argument.split(/\s+/).filter(Boolean);
      if (written.join(' ') !== rows.map(([text]) => text).join(' ')) {
        throw new Error(`${where}: ":::anatomy ${argument}" must name its parts in order, one per line`);
      }
      return { type: 'anatomy', parts: rows.map(([text, label]) => ({ text, label: inline(label) })) };
    }
    case 'sources':
      rows.forEach((row) => { if (row.length !== 1) throw new Error(`${where}: a source is one line, without "|"`); });
      return {
        type: 'sources',
        items: rows.map(([item]) => {
          const nodes = inline(item);
          if (nodes[0]?.type !== 'link') throw new Error(`${where}: a source starts with its link: "${item}"`);
          return nodes;
        }),
      };
  }
}

function table(lines: string[], where: string): Block {
  const rows = lines.map((line) => {
    if (!/^\|.*\|$/.test(line.trim())) throw new Error(`${where}: a table's line starts and ends with "|": "${line}"`);
    return cells(line.trim().slice(1, -1));
  });
  if (rows.length < 3 || !rows[1].every((cell) => /^:?-{3,}:?$/.test(cell))) throw new Error(`${where}: a table needs its heading, a "| --- |" line and a row`);
  const [head, , ...body] = rows;
  body.forEach((row) => { if (row.length !== head.length) throw new Error(`${where}: a table row has ${row.length} cells where its heading has ${head.length}`); });
  const inline = (text: string) => (text ? parseInline(text, where) : []);
  return { type: 'table', head: head.map(inline), rows: body.map((row) => row.map(inline)) };
}

/** The guide's body as blocks. */
export function parseBlocks(markdown: string, where = 'guide'): Block[] {
  const blocks: Block[] = [];
  const anchors = new Map<string, number>();
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = /^:::([a-z]+)(?: +(.*))?$/.exec(line);
    if (fence) {
      const name = fence[1] as Directive;
      if (!DIRECTIVES.includes(name)) throw new Error(`${where}: there is no ":::${fence[1]}"; the guides know ${DIRECTIVES.join(', ')}`);
      const end = lines.indexOf(':::', index + 1);
      if (end < 0) throw new Error(`${where}: ":::${name}" is not closed by a ":::" line`);
      blocks.push(directive(name, (fence[2] ?? '').trim(), lines.slice(index + 1, end), where));
      index = end + 1;
      continue;
    }
    if (line.startsWith(':::')) {
      throw new Error(`${where}: "${line}" opens nothing; a drawn block starts with ${DIRECTIVES.map((name) => `":::${name}"`).join(', ')} and ends with a ":::" line of its own`);
    }
    let end = index;
    while (end < lines.length && lines[end].trim() && !lines[end].startsWith(':::')) end += 1;
    const chunk = lines.slice(index, end);
    index = end;
    for (const item of chunk) {
      if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,}) *$/.test(item)) throw new Error(`${where}: a guide draws no lines across its text: "${item}"`);
      if (/^[*+] /.test(item)) throw new Error(`${where}: a list's items start with "- " or "1. ": "${item}"`);
    }
    const heading = /^(#{2,3}) (\S.*)$/.exec(chunk[0]);
    if (heading) {
      if (chunk.length > 1) throw new Error(`${where}: a heading stands alone, with an empty line below it: "${chunk[0]}"`);
      const text = parseInline(heading[2].trim(), where);
      const plain = plainText(text);
      const anchor = anchorOf(plain) || 'section';
      const seen = (anchors.get(anchor) ?? 0) + 1;
      anchors.set(anchor, seen);
      blocks.push({ type: 'heading', level: heading[1].length as 2 | 3, id: seen > 1 ? `${anchor}-${seen}` : anchor, text, plain });
    } else if (chunk[0].startsWith('#')) {
      throw new Error(`${where}: headings are "## " or "### ": "${chunk[0]}"`);
    } else if (/^- /.test(chunk[0])) {
      blocks.push({ type: 'list', ordered: false, items: listItems(chunk, /^- /, where).map((item) => parseInline(item, where)) });
    } else if (/^\d+\. /.test(chunk[0])) {
      blocks.push({ type: 'list', ordered: true, items: listItems(chunk, /^\d+\. /, where).map((item) => parseInline(item, where)) });
    } else if (chunk[0].startsWith('>')) {
      if (!chunk.every((item) => /^> \S/.test(item))) throw new Error(`${where}: every line of a note starts with "> "`);
      blocks.push({ type: 'note', text: parseInline(chunk.map((item) => item.slice(2).trim()).join(' '), where) });
    } else if (chunk[0].trimStart().startsWith('|')) {
      blocks.push(table(chunk, where));
    } else {
      if (chunk.some((item) => /^\s/.test(item))) throw new Error(`${where}: a paragraph's lines start at the margin: "${chunk.join(' ')}"`);
      blocks.push({ type: 'paragraph', text: parseInline(chunk.map((item) => item.trim()).join(' '), where) });
    }
  }
  return blocks;
}

/** A file's fields, the ones it may hold each written once as `name: value` between two `---` lines, then its body. */
function frontMatter(source: string, names: readonly Field[], where: string, kind: string) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source.replace(/\r\n?/g, '\n'));
  if (!match) throw new Error(`${where}: a ${kind} starts with its ${names.slice(0, -2).join(', ')} and dates between two "---" lines`);
  const fields = new Map<string, string>();
  for (const line of match[1].split('\n')) {
    const field = /^([a-z]+): (\S.*)$/.exec(line);
    if (!field || !names.includes(field[1] as Field) || fields.has(field[1])) {
      throw new Error(`${where}: "${line}" is not one of ${names.join(', ')}, each written once as "name: value"`);
    }
    fields.set(field[1], field[2].trim());
  }
  const value = (name: Field) => {
    const found = fields.get(name);
    if (!found) throw new Error(`${where}: "${name}" is missing`);
    return found;
  };
  return { value, body: match[2] };
}

/** The checks a guide and a carrier's page share: an address, two days in order, and a lead to open with. */
function checked<Text extends CarrierText>(text: Text, where: string, kind: string): Text {
  if (!GUIDE_SLUG.test(text.slug)) throw new Error(`${where}: the slug is lowercase letters, digits and hyphens: "${text.slug}"`);
  for (const day of [text.published, text.updated]) {
    if (!isDay(day)) throw new Error(`${where}: a date is a day of the calendar, written 2026-01-31, not "${day}"`);
  }
  if (text.updated < text.published) throw new Error(`${where}: a ${kind} cannot be updated before it is published`);
  if (!text.blocks.length) throw new Error(`${where}: the ${kind} has no text`);
  if (text.blocks[0].type !== 'paragraph') throw new Error(`${where}: a ${kind} opens with a paragraph, which the page sets as its lead`);
  if (text.blocks.filter((block) => block.type === 'checker').length > 1) throw new Error(`${where}: a ${kind} holds one ":::checker" at most`);
  return text;
}

/** A guide's file: what stands between the two `---` lines, then its body. */
export function parseGuide(source: string, where = 'guide'): Guide {
  const { value, body } = frontMatter(source, FIELDS, where, 'guide');
  return checked({
    title: value('title'), description: value('description'), slug: value('slug'), picture: value('picture'),
    published: value('published'), updated: value('updated'), blocks: parseBlocks(body, where),
  }, where, 'guide');
}

/** A carrier's page: a guide's file without a picture. */
export function parseCarrierText(source: string, where = 'carrier'): CarrierText {
  const { value, body } = frontMatter(source, FIELDS.filter((name) => name !== 'picture'), where, 'carrier page');
  return checked({
    title: value('title'), description: value('description'), slug: value('slug'),
    published: value('published'), updated: value('updated'), blocks: parseBlocks(body, where),
  }, where, 'carrier page');
}

/** The narrow no-break space French sets before `?`, `!` and `;`. */
const NARROW_SPACE = '\u202f';

/** The no-break space French sets before `:` and inside « », as the app's own French does. */
const NO_BREAK_SPACE = '\u00a0';

/** French text with the no-break spaces its punctuation takes, where the writer typed a plain space. */
export function frenchSpacing(text: string): string {
  return text.replace(/ (?=[?!;])/g, NARROW_SPACE).replace(/ (?=[:»])/g, NO_BREAK_SPACE).replace(/« /g, `«${NO_BREAK_SPACE}`);
}

function spacedRun(nodes: readonly Inline[]): Inline[] {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text': return { type: 'text', text: frenchSpacing(node.text) };
      case 'code': return node;
      default: return { ...node, children: spacedRun(node.children) };
    }
  });
}

function spacedBlock(block: Block): Block {
  switch (block.type) {
    case 'heading': return { ...block, text: spacedRun(block.text), plain: frenchSpacing(block.plain) };
    case 'paragraph': case 'note': return { ...block, text: spacedRun(block.text) };
    case 'list': case 'sources': return { ...block, items: block.items.map(spacedRun) };
    case 'table': return { ...block, head: block.head.map(spacedRun), rows: block.rows.map((row) => row.map(spacedRun)) };
    case 'steps': return { ...block, items: block.items.map(({ title, note }) => ({ title: spacedRun(title), note: spacedRun(note) })) };
    case 'anatomy': return { ...block, parts: block.parts.map(({ text, label }) => ({ text, label: spacedRun(label) })) };
    case 'journey': return { ...block, stops: block.stops.map(({ icon, title, note }) => ({ icon, title: spacedRun(title), note: spacedRun(note) })) };
    case 'checker': return block;
  }
}

/**
 * A guide's words as its language sets them. French takes a narrow no-break space before `?`, `!` and
 * `;`, and a full one before `:` and inside « », so writers type a plain space and the page shows the right one. Code, which
 * quotes a tracking number or a carrier's words as they are, keeps its spaces.
 */
export function typeset<Text extends CarrierText & { picture?: string }>(text: Text, language: string): Text {
  if (language !== 'fr') return text;
  return {
    ...text,
    title: frenchSpacing(text.title),
    description: frenchSpacing(text.description),
    ...(text.picture === undefined ? {} : { picture: frenchSpacing(text.picture) }),
    blocks: text.blocks.map(spacedBlock),
  };
}

/** A block's runs of text, each read on its own. */
function runsOf(block: Block): Inline[][] {
  switch (block.type) {
    case 'heading': case 'paragraph': case 'note': return [block.text];
    case 'list': case 'sources': return block.items;
    case 'table': return [...block.head, ...block.rows.flat()];
    case 'steps': return block.items.flatMap(({ title, note }) => [title, note]);
    case 'anatomy': return block.parts.map(({ label }) => label);
    case 'journey': return block.stops.flatMap(({ title, note }) => [title, note]);
    case 'checker': return [];
  }
}

function linked(blocks: readonly Block[], type: 'guide' | 'carrier'): string[] {
  const ids = new Set<string>();
  const walk = (nodes: readonly Inline[]) => nodes.forEach((node) => {
    if (node.type === type) ids.add(node.id);
    if ('children' in node) walk(node.children);
  });
  blocks.forEach((block) => runsOf(block).forEach(walk));
  return [...ids];
}

/** Every guide a text links, by id. */
export function linkedGuides(blocks: readonly Block[]): string[] {
  return linked(blocks, 'guide');
}

/** Every carrier's page a text links, by id. */
export function linkedCarriers(blocks: readonly Block[]): string[] {
  return linked(blocks, 'carrier');
}

/**
 * The questions a carrier's page answers: its last `## ` section before the sources holds them, each a
 * `### ` heading, its answer the blocks below it. A search engine is told them as the page's FAQ.
 */
export function questions(blocks: readonly Block[]): { question: string; answer: Block[] }[] {
  const end = blocks.at(-1)?.type === 'sources' ? blocks.length - 1 : blocks.length;
  const opensSection = (block: Block) => block.type === 'heading' && block.level === 2;
  let start = end - 1;
  while (start >= 0 && !opensSection(blocks[start])) start -= 1;
  if (start < 0) return [];
  const found: { question: string; answer: Block[] }[] = [];
  for (const block of blocks.slice(start + 1, end)) {
    if (block.type === 'heading') found.push({ question: block.plain, answer: [] });
    else found.at(-1)?.answer.push(block);
  }
  return found;
}

/** Some blocks' words without their marks, a space between runs: what a search engine is told a question's answer says. */
export function plainBlocks(blocks: readonly Block[]): string {
  return blocks.flatMap(runsOf).map(plainText).join(' ');
}

/** How many words a guide has, for its reading time and to tell a translation that lost a part. */
export function wordCount(blocks: readonly Block[]): number {
  return blocks.flatMap(runsOf).reduce((count, run) => count + plainText(run).split(/\s+/).filter(Boolean).length, 0);
}

/** The drawn blocks of a guide in order, which every translation shares: `steps:4`, `anatomy:RR 12345678 5 CH`. */
export function figureShape(blocks: readonly Block[]): string[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'steps': return [`steps:${block.items.length}`];
      case 'journey': return [`journey:${block.stops.map(({ icon }) => icon).join(',')}`];
      case 'anatomy': return [`anatomy:${block.parts.map(({ text }) => text).join(' ')}`];
      case 'checker': return ['checker'];
      default: return [];
    }
  });
}
