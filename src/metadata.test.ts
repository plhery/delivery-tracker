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
const LANDING_TITLE = 'Peek — Where’s my parcel?';
const LANDING_DESCRIPTION =
  'Paste a tracking number, a carrier link or a shipping email and see where your parcel is. 3,500+ carriers, checked every 10 minutes. Open source, no account needed.';

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

  it('draws the browser tab with the mark on its rounded tile and the Home Screen with the full-bleed icon', () => {
    expect(layoutMetadata.icons).toEqual({
      icon: { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      apple: '/icons/apple-touch-icon.png',
    });
  });

  it('titles the landing with the question it answers, the same in canonical and social metadata', async () => {
    const metadata = await generateMetadata();
    expect(metadata).toMatchObject({
      metadataBase: new URL('https://delivery.example.test/'),
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
      alternates: { canonical: 'https://delivery.example.test/' },
      openGraph: {
        siteName: 'Peek',
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
      },
      twitter: {
        title: LANDING_TITLE,
        description: LANDING_DESCRIPTION,
      },
    });
  });

  it('links the preview image by its contents, so a redrawn image replaces cached copies', async () => {
    const { twitter } = await generateMetadata();
    const digest = createHash('sha256').update(readFileSync('public/og.png')).digest('hex').slice(0, 8);
    expect(twitter?.images).toEqual([`https://delivery.example.test/og.png?v=${digest}`]);
  });
});
