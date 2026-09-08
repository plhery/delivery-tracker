import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../src/styles.css';
import { APPEARANCE_BOOTSTRAP } from '../src/lib/appearanceConfig';

export const metadata: Metadata = {
  applicationName: 'Delivery Tracker',
  title: 'Delivery Tracker',
  description:
    'Private parcel tracking, with alerts and history synced across your devices.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Deliveries',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F4F5F1',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }} /></head>
      <body>{children}</body>
    </html>
  );
}
