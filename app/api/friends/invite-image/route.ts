import { isLocale } from '../../../../src/lib/locale';
import { invitationSocialNickname } from '../../../../src/server/invitationSocial';
import { invitationSocialImage } from '../../../../src/server/InvitationSocialImage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const previews = parameters.getAll('preview');
  const language = parameters.get('lang');
  const nickname = await invitationSocialNickname(previews.length === 1 ? previews[0] : undefined, request.headers);
  return invitationSocialImage(nickname, isLocale(language) ? language : 'en');
}
