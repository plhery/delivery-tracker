import type { Metadata } from 'next';
import { connection } from 'next/server';
import { FeedbackScreen } from '../../src/components/FeedbackScreen';
import { requestLanguage } from '../../src/server/requestLocale';

/** What the service worker shows without a network is not a page to find in a search. */
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default async function OfflinePage() {
  // Cache a response with its matching CSP nonce, so translated controls hydrate offline.
  await connection();
  return <FeedbackScreen title="offline.title" description="offline.description" {...await requestLanguage()} />;
}
