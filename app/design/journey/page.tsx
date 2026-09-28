import type { Metadata } from 'next';
import { connection } from 'next/server';
import { JourneyDesign } from '../../../src/design/journey/JourneyDesign';

export const metadata: Metadata = {
  title: 'Parcel journeys · Design exploration',
  description: 'Explore three responsive parcel map designs with fictional journeys.',
  robots: { index: false, follow: false },
};

export default async function JourneyDesignPage() {
  await connection();
  return <JourneyDesign />;
}
