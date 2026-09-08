import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ClientApplication } from '../../src/ClientApplication';

export const metadata: Metadata = {
  title: 'An invitation for you · Delivery Tracker',
  description: 'A friend sent you a parcel. Tap to open your invitation.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function InvitationPage() {
  await connection();
  return <ClientApplication invitationRoute />;
}
