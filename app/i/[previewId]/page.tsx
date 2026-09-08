import type { Metadata } from 'next';
import { isInvitationPreviewId } from '../../../src/lib/invitationLinkFormat';
import { invitationMetadata } from '../../../src/server/invitationMetadata';

export async function generateMetadata({ params }: { params: Promise<{ previewId: string }> }): Promise<Metadata> {
  const { previewId } = await params;
  return invitationMetadata(isInvitationPreviewId(previewId) ? previewId : undefined);
}

export { default } from '../../invite/page';
