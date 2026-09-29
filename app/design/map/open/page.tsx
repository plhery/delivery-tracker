import type { Metadata } from 'next';
import { connection } from 'next/server';
import { OpenMapStudy } from '../../../../src/design/openMap/OpenMapStudy';

export const metadata: Metadata = {
  title: 'The open map · Map design study',
  description: 'Four ways the full parcel map could tell a journey once it is open: an itinerary, a replay, a departure board and a night flight.',
  robots: { index: false, follow: false },
};

export default async function OpenMapDesignPage() {
  await connection();
  return <OpenMapStudy />;
}
