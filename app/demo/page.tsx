import { connection } from 'next/server';
import { ClientApplication } from '../../src/ClientApplication';
import { requestLanguage } from '../../src/server/requestLocale';

/** The demo deliveries, for anyone: nothing here needs an account or leaves the device. */
export default async function DemoPage() {
  await connection();
  return <ClientApplication demoRoute {...await requestLanguage()} />;
}
