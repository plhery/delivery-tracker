import type { Metadata } from 'next';
import { connection } from 'next/server';
import { AccountClientApplication } from '../../src/AccountClientApplication';
import { emailConfigured } from '../../src/server/email/config';
import { invitationMetadata } from '../../src/server/invitationMetadata';
import { requestLanguage } from '../../src/server/requestLocale';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }): Promise<Metadata> {
  return invitationMetadata((await searchParams).preview);
}

export default async function InvitationPage() {
  await connection();
  return <AccountClientApplication invitationRoute deliveryEmails={emailConfigured()} {...await requestLanguage()} />;
}
