import type { Metadata } from 'next';
import { peekPicture } from '../src/lib/peekPicture';
import { emailConfigured } from '../src/server/email/config';
import { requestMovedOrigin, requestOrigin } from '../src/server/requestOrigin';
import { requestLanguage } from '../src/server/requestLocale';
import { connection } from 'next/server';
import { ClientApplication } from '../src/ClientApplication';

// The landing's own title is the question it answers; the description says only what the page itself claims.
const title = 'Peek — Where’s my parcel?';
const description =
  'Paste a tracking number, a carrier link or a shipping email and see where your parcel is. 3,500+ carriers, checked every 10 minutes. Open source, no account needed.';

export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  const picture = peekPicture(origin);
  return {
    metadataBase: origin,
    title,
    description,
    alternates: { canonical: origin.href },
    openGraph: {
      type: 'website',
      url: origin.href,
      siteName: 'Peek',
      title,
      description,
      images: [picture],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [picture.url],
    },
  };
}

export default async function HomePage() {
  await connection();
  return <ClientApplication movedTo={await requestMovedOrigin()} deliveryEmails={emailConfigured()} {...await requestLanguage()} />;
}
