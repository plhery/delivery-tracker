import { connection } from 'next/server';
import { FeedbackScreen } from '../src/components/FeedbackScreen';

export default async function NotFound() {
  await connection();
  return <FeedbackScreen title="web.notFoundTitle" description="web.notFoundDescription" />;
}
