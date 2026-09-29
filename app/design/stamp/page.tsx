import type { Metadata } from 'next';
import { connection } from 'next/server';
import { StampStudy } from '../../../src/design/stamp/StampStudy';

export const metadata: Metadata = {
  title: 'The stamp · Design study',
  description: 'Ways to make the parcel card’s stamp properly, swap it for a postmark, or drop it.',
  robots: { index: false, follow: false },
};

export default async function StampDesignPage() {
  await connection();
  return <StampStudy />;
}
