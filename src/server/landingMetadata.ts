import 'server-only';
import type { Metadata } from 'next';
import { peekPicture } from '../lib/peekPicture';
import { requestOrigin } from './requestOrigin';

// The landing's own title is the question it answers; the description says only what the page itself claims.
const title = 'Peek — Where’s my parcel?';
const description =
  'Paste a tracking number, a carrier link or a shipping email and see where your parcel is. 3,500+ carriers, checked every 10 minutes. Open source, no account needed.';

/** The landing's metadata. It names `/` as the page's address, at whichever address the landing shows. */
export async function landingMetadata(): Promise<Metadata> {
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
