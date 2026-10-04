import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => ({ language: 'en' }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({
    host: 'delivery.example.test',
    'x-forwarded-proto': 'https',
    'accept-language': request.language,
  })),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

import { generateMetadata as demoMetadata } from '../app/demo/page';
import { generateMetadata as layoutMetadata } from '../app/layout';
import manifest from '../app/manifest';
import { generateMetadata as landingAddressMetadata } from '../app/home/page';
import { generateMetadata } from '../app/page';
import mark from './brand/mark.json';

const TITLE = 'Peek — Universal Parcel Tracker';
const DESCRIPTION =
  'Private parcel tracking, with alerts and history synced across your devices.';
const LANDING_TITLE = 'Peek — Where’s my parcel?';
const LANDING_DESCRIPTION =
  'Paste a tracking number, a carrier link or a shipping email and see where your parcel is. 3,500+ carriers, checked every 10 minutes. Open source, no account needed.';

describe('public product metadata', () => {
  it('names the site and the installed PWA Peek, with what it does where the name stands alone', async () => {
    expect(await layoutMetadata()).toMatchObject({
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

  it('draws the browser tab with the mark on its rounded tile and the Home Screen with the full-bleed icon', async () => {
    expect((await layoutMetadata()).icons).toEqual({
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

  it('names `/` as the landing’s address at the landing’s own address too', async () => {
    expect(await landingAddressMetadata()).toEqual(await generateMetadata());
    expect((await landingAddressMetadata()).alternates).toEqual({ canonical: 'https://delivery.example.test/' });
  });

  it('links the preview image by its contents, so a redrawn image replaces cached copies', async () => {
    const { twitter } = await generateMetadata();
    const digest = createHash('sha256').update(readFileSync('public/og.png')).digest('hex').slice(0, 8);
    expect(twitter?.images).toEqual([`https://delivery.example.test/og.png?v=${digest}`]);
  });

  it('gives a page that draws no preview of its own Peek’s picture, under the page’s own title', async () => {
    const { metadataBase, openGraph, twitter } = await layoutMetadata();
    const { twitter: landing } = await generateMetadata();
    expect(metadataBase).toEqual(new URL('https://delivery.example.test/'));
    expect(openGraph).toEqual({
      type: 'website',
      siteName: 'Peek',
      images: [{ url: (landing?.images as string[])[0], width: 1_200, height: 630, alt: expect.stringContaining('Where’s my parcel?') }],
    });
    // Without a title or a description here, each page's own are shared.
    expect(twitter).toEqual({ card: 'summary_large_image', images: landing?.images });
  });

  it('names the demo and says where its parcels stay, in the reader’s language', async () => {
    expect(await demoMetadata()).toEqual({ title: 'Peek — Demo mode', description: 'These sample parcels stay on this device.' });
    request.language = 'de-CH,de;q=0.9';
    expect(await demoMetadata()).toEqual({ title: 'Peek — Demo-Modus', description: 'Diese Beispielpakete bleiben auf diesem Gerät.' });
    request.language = 'en';
  });

  it('signs the preview picture with the mark as it is drawn everywhere else', () => {
    const picture = readFileSync('public/og.svg', 'utf8');
    const { size, tile, shapes } = mark;
    expect(picture).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(picture).toContain(`<rect width="${size}" height="${size}" rx="${tile.radius}" fill="${tile.fill}"/>`);
    for (const { tag, ...attributes } of shapes) {
      expect(picture).toContain(`<${tag} ${Object.entries(attributes).map(([name, value]) => `${name}="${value}"`).join(' ')}/>`);
    }
  });
});
