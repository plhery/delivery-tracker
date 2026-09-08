import { connection } from 'next/server';
import { FeedbackScreen } from '../../src/components/FeedbackScreen';

export default async function OfflinePage() {
  // Cache a response with its matching CSP nonce, so translated controls hydrate offline.
  await connection();
  return <FeedbackScreen title="offline.title" description="offline.description" />;
}
