import { connection } from 'next/server';
import { FeedbackScreen } from '../src/components/FeedbackScreen';
import { requestLocale } from '../src/server/requestLocale';

export default async function NotFound() {
  await connection();
  return <FeedbackScreen title="web.notFoundTitle" description="web.notFoundDescription" initialLocale={await requestLocale()} />;
}
