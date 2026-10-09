import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../src/styles.css';
import { authConfigFromEnvironment } from '../src/auth/authConfig';
import { APPEARANCE_BOOTSTRAP } from '../src/lib/appearanceConfig';
import { ENTRY_HINT_BOOTSTRAP } from '../src/lib/entryHintConfig';
import { documentLanguage, manifestPath } from '../src/lib/locale';
import { requestLocale } from '../src/server/requestLocale';
import { requestOrigin } from '../src/server/requestOrigin';
import { PREVIEW_LOCALES, sitePicture, siteTitle, wordsIn } from '../src/server/sitePreview';

const site: Metadata = {
  applicationName: 'Peek',
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

/**
 * Peek's name and what it is, in the reader's language, for the page and for the app a
 * browser installs from it. A page that draws no preview of its own shares Peek's picture,
 * under its own title and description.
 */
export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  const locale = await requestLocale();
  const t = wordsIn(locale);
  const picture = sitePicture(origin, locale);
  return {
    ...site,
    title: siteTitle(t),
    description: t('preview.site.description'),
    metadataBase: origin,
    manifest: manifestPath(locale),
    openGraph: { type: 'website', siteName: 'Peek', locale: PREVIEW_LOCALES[locale], images: [picture] },
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
    <html lang={documentLanguage(await requestLocale())} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} />
        {/* Tells the stylesheet, before anything is painted, who is about to see the landing. */}
        <script dangerouslySetInnerHTML={{ __html: ENTRY_HINT_BOOTSTRAP }} />
        {authOrigin && <link rel="preconnect" href={authOrigin} crossOrigin="anonymous" />}
      </head>
      <body>{children}</body>
    </html>
  );
}
