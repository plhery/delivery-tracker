import type { Metadata } from 'next';
import { connection } from 'next/server';
import { AccountClientApplication } from '../../src/AccountClientApplication';
import { translateMessage } from '../../src/lib/messages';
import { emailConfigured } from '../../src/server/email/config';
import { messagesFor, requestLanguage, requestLocale } from '../../src/server/requestLocale';

/**
 * The demo says what it is, in the reader's language: its banner's name, and where its parcels stay.
 * Its parcels are made up and drawn by the browser, so it is not a page to find in a search.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const messages = messagesFor(locale);
  return {
    title: `${translateMessage(locale, 'app.title', undefined, messages)} — ${translateMessage(locale, 'app.demo', undefined, messages)}`,
    description: translateMessage(locale, 'app.demoDescription', undefined, messages),
    robots: { index: false, follow: true },
  };
}

/** The demo deliveries, for anyone: nothing here needs an account or leaves the device. */
export default async function DemoPage() {
  await connection();
  return <AccountClientApplication demoRoute deliveryEmails={emailConfigured()} {...await requestLanguage()} />;
}
