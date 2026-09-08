import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ClientApplication } from '../../src/ClientApplication';
import { invitationMetadata } from '../../src/server/invitationMetadata';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }): Promise<Metadata> {
  return invitationMetadata((await searchParams).preview);
}

export default async function InvitationPage() {
  await connection();
  return <ClientApplication invitationRoute />;
}
