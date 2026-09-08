import 'server-only';
import en from '../../shared/locales/en.json';
import fr from '../../shared/locales/fr.json';
import de from '../../shared/locales/de.json';
import it from '../../shared/locales/it.json';
import type { NativePushNotificationService, WebPushNotificationService, PushSummary } from './push';
import type { SupabaseServiceClient } from './supabase';
import type { JsonObject } from './types';
import { captureOperationalError, logOperationalEvent, errorType } from './observability';

const copy = { en, fr, de, it };
export function friendshipNotification(row: JsonObject): { web: JsonObject; native: JsonObject } {
  const requested = String(row.locale ?? 'en').split(/[-_]/)[0]!.toLowerCase();
  const language = Object.hasOwn(copy, requested) ? requested as keyof typeof copy : 'en';
  const title = copy[language]['friends.invitationAccepted'].replace('{{name}}', String(row.nickname ?? ''));
  const body = copy[language]['friends.viewPassport'];
  const id = String(row.friend_id);
  return {
    web: { title, body, lang: language, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
      tag: `friend-${id}`, data: { url: `/?view=friends&friend=${encodeURIComponent(id)}` } },
    native: { aps: { alert: { title, body }, sound: 'default', badge: 1, 'thread-id': 'friends' }, kind: 'friend_accepted', friend_id: id },
  };
}

export class FriendshipPushService {
  constructor(readonly client: SupabaseServiceClient, readonly web: WebPushNotificationService | null, readonly native: NativePushNotificationService | null) {}
  async dispatch(): Promise<PushSummary> {
    const summary: PushSummary = { attempted: 0, sent: 0, failed: 0, expired: 0 };
    if (!this.web && !this.native) return summary;
    const deliveries = await this.client.claimFriendshipPush(!!this.web, !!this.native);
    // Small leased batches run concurrently; each delivery retains its own acknowledgement.
    await Promise.all(deliveries.map(async (row) => {
      summary.attempted++;
      const payload = friendshipNotification(row);
      let success = false;
      try {
        if (row.device_id) await this.native!.send(row, payload.native);
        else await this.web!.send(row, payload.web);
        success = true; summary.sent++;
      } catch (error) {
        const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0;
        if (row.device_id ? this.native!.isExpired(error) : status === 404 || status === 410) {
          const values = { disabled_at: new Date().toISOString(), last_error: 'Notification destination expired' };
          if (row.device_id) await this.client.updateNativePushDevice(String(row.device_id), values);
          else await this.client.updatePushSubscription(String(row.subscription_id), values);
          summary.expired++;
        } else { summary.failed++; }
      } finally {
        await this.client.finishFriendshipPush(String(row.id), String(row.lease_token), success);
      }
    }));
    return summary;
  }
}

/** Runs independently of parcel sync; quiet-hour and failed receipts retry here. */
export class FriendshipPushWorker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  constructor(readonly service: FriendshipPushService) {}
  start() { this.stopped = false; if (!this.timer && !this.running) this.schedule(15_000); }
  wake() { if (this.running || this.stopped) return; if (this.timer) clearTimeout(this.timer); this.schedule(0); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule(delay: number) {
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, delay);
    this.timer.unref();
  }
  private async run() {
    this.running = true;
    try { await this.service.dispatch(); }
    catch (error) {
      logOperationalEvent('friendship_notification_failed', { error_type: errorType(error) }, 'error');
      captureOperationalError(error, { component: 'friendship-notifications', operation: 'dispatch' });
    } finally { this.running = false; if (!this.stopped) this.schedule(15_000); }
  }
}
