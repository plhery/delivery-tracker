'use client';

import { useEffect } from 'react';
import { FeedbackScreen } from '../src/components/FeedbackScreen';
import { reportCaughtError } from '../src/lib/errorReports';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportCaughtError(error), [error]);
  return <FeedbackScreen title="web.errorTitle" description="web.errorDescription" retry={reset} />;
}
