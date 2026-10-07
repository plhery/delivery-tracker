# Guides

Articles that answer what people ask a search engine about parcels. They live at
`/guides/<slug>` in English and `/<language>/guides/<slug>` in the other six languages.

- [`index.json`](index.json) lists the guides' ids in the order the site shows them.
- Each id is a folder with one file per language: `en.md`, `de.md`, `fr.md`, `it.md`,
  `es.md`, `pt.md` and `pl.md`.
- Each id has a picture in [`src/guides/scenes.tsx`](../../src/guides/scenes.tsx). It
  holds no words, so every language shares it.

After adding or changing a guide, run `npm run guides`. It checks every file and rewrites
the list the app links ([`src/generated/guides.ts`](../../src/generated/guides.ts)).
`npm run test:scripts` fails while a guide is incomplete or that list is stale.

## A guide's file

```md
---
title: Parcel held at customs: what it means and what to do
description: One or two sentences for the search result, 110 to 165 characters, saying what the reader gets.
slug: parcel-held-at-customs
picture: What the picture at the top shows, for readers who cannot see it.
published: 2026-10-04
updated: 2026-10-04
---

The first paragraph is the lead: the answer in two or three sentences.

## A question the reader has

Text.
```

- `title`: at most 60 characters, the query it answers, no year.
- `slug`: the address in that language, as lowercase ASCII letters, digits and hyphens.
  Changing it breaks links that already point at the guide.
- `updated`: the day the facts were last checked.

## What the text can hold

- `## ` and `### ` headings, paragraphs, `- ` and `1. ` lists, a `> ` note, and tables
  with a `| --- |` line under their heading.
- `**bold**`, `*italics*`, `` `code` `` for tracking numbers and a carrier's exact words.
- Links to an `https://` page, to the tracker as `[Peek](/)`, which leads to the landing in
  the guide's language, and to another guide by id as `[customs](guide:customs)`, which
  leads to that guide in the guide's language.
- A backslash before `*`, `[`, `]` or `|` writes the character itself.

Four blocks are drawn rather than set as text:

```md
:::steps
- Label created | The seller printed a label. The carrier has no parcel yet.
- Picked up | The first real scan.
:::

:::anatomy RR 12345678 5 CH
- RR | Type of mail
- 12345678 | Serial number
- 5 | Check digit
- CH | Country that issued the number
:::

:::journey
- shop | Seller | Label printed
- plane | Flight | No scans in the air
- home | You | Delivered
:::

:::sources
- [Universal Postal Union](https://www.upu.int/) – the S10 standard
:::
```

A journey's stops are `shop`, `label`, `warehouse`, `truck`, `plane`, `ship`, `customs`,
`handover`, `locker` and `home`. Every guide ends with its `:::sources`: the pages its
facts were read on.

## Writing and translating

- A guide states only what its sources say. Thresholds, fees and deadlines change: check
  them on the authority's or the carrier's own page, and set `updated`.
- A translation is the same guide for another country, not the same sentences: its
  carriers, shops, laws and examples are the reader's own. It keeps the drawn blocks of
  the English guide, in the same order.
- Tone follows the app ([shared/locales](../../shared/locales/README.md)): informal, short
  sentences, European Spanish and Portuguese.
- In French, type a plain space before `?`, `!`, `;` and `:` and inside « »: the page sets
  the narrow no-break space French takes there. Code keeps its spaces.
- Say what Peek does only where it helps the reader, and only what it does.
