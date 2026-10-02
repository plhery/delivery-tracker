import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({
    host: 'delivery.example.test',
    'x-forwarded-proto': 'https',
  })),
}));

import { metadata as layoutMetadata } from '../app/layout';
import manifest from '../app/manifest';
import { generateMetadata } from '../app/page';

const TITLE = 'Peek — Universal Parcel Tracker';
const DESCRIPTION =
  'Private parcel tracking, with alerts and history synced across your devices.';

describe('public product metadata', () => {
  it('names the site and the installed PWA Peek, with what it does where the name stands alone', () => {
    expect(layoutMetadata).toMatchObject({
      applicationName: 'Peek',
      title: TITLE,
      description: DESCRIPTION,
      appleWebApp: { title: 'Peek' },
    });
    expect(manifest()).toMatchObject({
      name: TITLE,
      short_name: 'Peek',
      description: DESCRIPTION,
    });
  });

  it('draws the browser tab with the glyph and the Home Screen with the full icon', () => {
    expect(layoutMetadata.icons).toEqual({
      icon: { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      apple: '/icons/apple-touch-icon.png',
    });
  });

  it('uses the same positioning in canonical and social metadata', async () => {
    const metadata = await generateMetadata();
    expect(metadata).toMatchObject({
      metadataBase: new URL('https://delivery.example.test/'),
      title: TITLE,
      description: DESCRIPTION,
      alternates: { canonical: 'https://delivery.example.test/' },
      openGraph: {
        siteName: 'Peek',
        title: TITLE,
        description: DESCRIPTION,
      },
      twitter: {
        title: TITLE,
        description: DESCRIPTION,
      },
    });
  });

  it('links the preview image by its contents, so a redrawn image replaces cached copies', async () => {
    const { twitter } = await generateMetadata();
    const digest = createHash('sha256').update(readFileSync('public/og.png')).digest('hex').slice(0, 8);
    expect(twitter?.images).toEqual([`https://delivery.example.test/og.png?v=${digest}`]);
  });
});
