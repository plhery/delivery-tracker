import { invitationSocialNickname } from '../../../../src/server/invitationSocial';
import { invitationSocialImage } from '../../../../src/server/InvitationSocialImage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const previews = new URL(request.url).searchParams.getAll('preview');
  const nickname = await invitationSocialNickname(previews.length === 1 ? previews[0] : undefined, request.headers);
  return invitationSocialImage(nickname);
}
