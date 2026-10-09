import type { Metadata } from 'next';
import { connection } from 'next/server';
import { EmailOffScreen } from '../../../src/components/EmailOffScreen';
import { isLocale } from '../../../src/lib/locale';
import { translateMessage } from '../../../src/lib/messages';
import { languageFor, messagesFor, namedLocale } from '../../../src/server/requestLocale';

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** The link belongs to one account: its page is never indexed and never leaves as a referrer. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = await namedLocale((await searchParams).lang);
  const messages = messagesFor(locale);
  return {
    title: `${translateMessage(locale, 'app.title', undefined, messages)} — ${translateMessage(locale, 'email.off.askTitle', undefined, messages)}`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

/**
 * Where the "turn it off" link of a delivery email leads, at
 * `/email/off?lang=<language>#t=<token>`. The server renders the same page for
 * everyone who reads the email's language: the token stands after the `#`, so
 * it is read and sent by the browser alone. A link that names no language, as
 * an older email's, speaks the request's.
 */
export default async function EmailOffPage({ searchParams }: Props) {
  await connection();
  const { lang } = await searchParams;
  return <EmailOffScreen {...languageFor(await namedLocale(lang))} emailLocale={isLocale(lang) ? lang : undefined} />;
}
