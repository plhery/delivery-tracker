import type { Metadata } from 'next';
import { connection } from 'next/server';
import { EmailOffScreen } from '../../../src/components/EmailOffScreen';
import { translateMessage } from '../../../src/lib/messages';
import { messagesFor, requestLanguage, requestLocale } from '../../../src/server/requestLocale';

/** The link belongs to one account: its page is never indexed and never leaves as a referrer. */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const messages = messagesFor(locale);
  return {
    title: `${translateMessage(locale, 'app.title', undefined, messages)} — ${translateMessage(locale, 'email.off.askTitle', undefined, messages)}`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/**
 * Where the "turn it off" link of a delivery email leads, at
 * `/email/off#t=<token>`. The server renders the same page for everyone: the
 * token stands after the `#`, so it is read and sent by the browser alone.
 */
export default async function EmailOffPage() {
  await connection();
  return <EmailOffScreen {...await requestLanguage()} />;
}
