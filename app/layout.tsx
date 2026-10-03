import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../src/styles.css';
import { authConfigFromEnvironment } from '../src/auth/authConfig';
import { APPEARANCE_BOOTSTRAP } from '../src/lib/appearanceConfig';
import { ENTRY_HINT_BOOTSTRAP } from '../src/lib/entryHintConfig';
import { peekPicture } from '../src/lib/peekPicture';
import { requestLocale } from '../src/server/requestLocale';
import { requestOrigin } from '../src/server/requestOrigin';

const site: Metadata = {
  applicationName: 'Peek',
  title: 'Peek — Universal Parcel Tracker',
  description:
    'Private parcel tracking, with alerts and history synced across your devices.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: { url: '/icons/favicon.svg', type: 'image/svg+xml' },
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Peek',
  },
};

/** A page that draws no preview of its own shares Peek's picture, under its own title and description. */
export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  const picture = peekPicture(origin);
  return {
    ...site,
    metadataBase: origin,
    openGraph: { type: 'website', siteName: 'Peek', images: [picture] },
    twitter: { card: 'summary_large_image', images: [picture.url] },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F4F5F1',
};

// A returning account refreshes its sign-in there first; open the connection while the page loads.
const authOrigin = authConfigFromEnvironment({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
})?.url;

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={await requestLocale()} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
        {/* Tells the stylesheet, before anything is painted, who is about to see the landing at `/`. */}
        <script dangerouslySetInnerHTML={{ __html: ENTRY_HINT_BOOTSTRAP }} />
        {authOrigin && <link rel="preconnect" href={authOrigin} crossOrigin="anonymous" />}
      </head>
      <body>{children}</body>
    </html>
  );
}
