'use client';

import { FeedbackScreen } from '../src/components/FeedbackScreen';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <FeedbackScreen title="web.errorTitle" description="web.errorDescription" retry={reset} />;
}
