import type { Metadata } from 'next';
import { connection } from 'next/server';
import { MapStudy } from '../../../src/design/map/MapStudy';

export const metadata: Metadata = {
  title: 'Near and far · Map design study',
  description: 'Three Flighty-inspired ways to show where a parcel has been, from a globe to a close-up.',
  robots: { index: false, follow: false },
};

export default async function MapDesignPage() {
  await connection();
  return <MapStudy />;
}
