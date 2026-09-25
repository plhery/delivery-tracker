import { connection } from 'next/server';
import { FeedbackScreen } from '../src/components/FeedbackScreen';
import { requestLanguage } from '../src/server/requestLocale';

export default async function NotFound() {
  await connection();
  return <FeedbackScreen title="web.notFoundTitle" description="web.notFoundDescription" {...await requestLanguage()} />;
}
