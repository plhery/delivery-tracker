import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../src/styles.css';
import { authConfigFromEnvironment } from '../src/auth/authConfig';
import { APPEARANCE_BOOTSTRAP } from '../src/lib/appearanceConfig';
import { requestLocale } from '../src/server/requestLocale';

export const metadata: Metadata = {
  applicationName: 'Peek',
  title: 'Peek — Universal Parcel Tracker',
  description:
    'Private parcel tracking, with alerts and history synced across your devices.',
  manifest: '/manifest.webmanifest',
  icons: {
    // A tab draws the icon at 16 px, where only the eyes and the lid still read.
    icon: { url: '/icons/favicon.svg', type: 'image/svg+xml' },
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Peek',
  },
};

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
        {authOrigin && <link rel="preconnect" href={authOrigin} crossOrigin="anonymous" />}
      </head>
      <body>{children}</body>
    </html>
  );
}
