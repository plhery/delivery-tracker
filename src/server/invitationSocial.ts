import 'server-only';
import { clientIp, HttpError } from './api';
import { invitationPreviewByHash, invitationPreviewById } from './friends';
import { isInvitationPreviewId } from '../lib/invitationLinkFormat';
import { captureOperationalError } from './observability';
import { RateLimiter } from './rateLimit';
import { serviceClient } from './runtime';

const limiter = new RateLimiter();
export const invitationDescription = 'Tap to open your invitation on Delivery Tracker.';

export function invitationTitle(nickname: string | null): string {
  return nickname ? `Your friend ${nickname} sent you an invitation` : 'A friend sent you an invitation';
}

export async function invitationSocialNickname(preview: string | string[] | undefined, headers: Headers): Promise<string | null> {
  if (typeof preview !== 'string' || (!isInvitationPreviewId(preview) && !/^[a-f0-9]{64}$/.test(preview))) return null;
  if (limiter.retryAfter(`invitation-social:${clientIp({ headers })}`, { limit: 60, window: 60 })) return null;
  try {
    const client = serviceClient();
    if (!client) return null;
    const result = isInvitationPreviewId(preview)
      ? await invitationPreviewById(client, preview)
      : await invitationPreviewByHash(client, preview);
    return result.previewNickname;
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) {
      captureOperationalError(error, { component: 'friends', operation: 'invitation-social-preview' });
    }
    return null;
  }
}
