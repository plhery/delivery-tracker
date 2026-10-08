import 'server-only';

import type { ApiPackageRow } from '../../generated/apiContract';
import { isLocale, type Locale } from '../../lib/locale';
import { withEventPlaces } from '../eventPlaces';
import { recordDeliveryEmail, type DeliveryEmailReason } from '../metrics';
import { captureOperationalError, errorType, logOperationalEvent } from '../observability';
import type { DeliveryEmailClaim, SupabaseServiceClient } from '../supabase';
import type { JsonObject } from '../types';
import { emailSettings, undeliverableAddress, type EmailSettings } from './config';
import { deliveryEmailContent } from './content';
import { EmailSendError, openTransport, type EmailTransport, type OutgoingEmail } from './transport';
import { DELIVERY_CARD_CID, type DeliveryEmailContent } from './types';
import { unsubscribeUrls } from './unsubscribe';

/** Scans one run claims. The rest wait for the next run, which follows every sync job. */
const CLAIMS_PER_RUN = 20;

export interface DeliveryEmailSummary {
  sent: number;
  failed: number;
  skipped: number;
}

type Ending =
  | { outcome: 'sent' }
  | { outcome: 'skipped'; reason: DeliveryEmailReason }
  | { outcome: 'failed'; reason: DeliveryEmailReason; error?: unknown };

function accountLocale(stored: string | null): Locale {
  const language = stored?.toLowerCase().split(/[-_]/)[0];
  return isLocale(language) ? language : 'en';
}

/**
 * Tells accounts by email that a parcel was delivered, or is ready to collect:
 * one email per parcel, about whichever comes first. The database decides
 * which scans are news and hands each parcel out once (see
 * `claim_delivery_emails`); this writes the email, sends it and records how it
 * ended. An email that could not be sent is claimed again later, up to three
 * times while its scan is fresh. One email that fails never stops the others.
 */
export class DeliveryEmailService {
  constructor(
    readonly client: SupabaseServiceClient,
    readonly settings: EmailSettings,
    readonly open: (settings: EmailSettings) => EmailTransport = openTransport,
    readonly now: () => Date = () => new Date(),
  ) {}

  async dispatch(signal?: AbortSignal): Promise<DeliveryEmailSummary> {
    signal?.throwIfAborted();
    const summary: DeliveryEmailSummary = { sent: 0, failed: 0, skipped: 0 };
    const claimed = await this.client.claimDeliveryEmails(
      CLAIMS_PER_RUN, this.settings.perAccountPerDay, this.settings.perDay,
    );
    // Beyond an allowance, an email is recorded as skipped by the claim itself.
    for (const [reason, total] of [['account_cap', claimed.accountCap], ['service_cap', claimed.serviceCap]] as const) {
      if (total <= 0) continue;
      summary.skipped += total;
      recordDeliveryEmail('skipped', reason, total);
      logOperationalEvent('delivery_emails_capped', { reason, emails: total }, 'warning');
    }
    if (claimed.send.length === 0) return summary;

    const reported = new Set<string>();
    const transport = this.open(this.settings);
    try {
      for (const claim of claimed.send) {
        // A run that is stopped hands back what it has not sent, to be claimed again.
        const ending: Ending = signal?.aborted
          ? { outcome: 'failed', reason: 'interrupted' }
          : await this.deliver(claim, transport);
        summary[ending.outcome] += 1;
        this.record(claim, ending, reported);
        try {
          await this.client.finishDeliveryEmail(claim.id, ending.outcome, ending.outcome === 'sent' ? null : ending.reason);
        } catch (error) {
          // The claim stays open and is never handed out again: no email goes out twice.
          logOperationalEvent('delivery_email_finish_failed', {
            package_id: claim.packageId, outcome: ending.outcome, error_type: errorType(error),
          }, 'error');
          if (!signal?.aborted) captureOperationalError(error, { component: 'delivery-email', operation: 'finish' });
        }
      }
    } finally {
      transport.close();
    }
    signal?.throwIfAborted();
    return summary;
  }

  private async deliver(claim: DeliveryEmailClaim, transport: EmailTransport): Promise<Ending> {
    let account: Awaited<ReturnType<SupabaseServiceClient['getAuthAccount']>>;
    try {
      account = await this.client.getAuthAccount(claim.userId);
    } catch (error) {
      return { outcome: 'failed', reason: 'account', error };
    }
    const address = account?.email ?? null;
    const undeliverable = undeliverableAddress(this.settings, address, account?.emailConfirmed === true);
    if (undeliverable || address === null) return { outcome: 'skipped', reason: undeliverable ?? 'no_address' };

    let parcel: JsonObject | null;
    try {
      parcel = await this.client.getOwnedPackage(claim.packageId, claim.userId);
    } catch (error) {
      return { outcome: 'failed', reason: 'parcel', error };
    }
    if (!parcel) return { outcome: 'skipped', reason: 'parcel_gone' };

    let message: OutgoingEmail;
    try {
      const links = unsubscribeUrls(this.settings.origin, claim.userId);
      const content = await deliveryEmailContent({
        parcel: withEventPlaces(parcel) as unknown as ApiPackageRow,
        locale: accountLocale(account?.locale ?? null),
        stage: claim.stage,
        timezone: claim.timezone,
        // What a notification opens.
        journeyUrl: `${this.settings.origin}/?parcel=${encodeURIComponent(claim.packageId)}`,
        offUrl: links.page,
        deliveredTime: claim.deliveredTime,
        now: this.now(),
      });
      message = deliveryEmail(address, content, links.oneClick);
    } catch (error) {
      return { outcome: 'failed', reason: 'content', error };
    }

    try {
      await transport.send(message);
    } catch (error) {
      return { outcome: 'failed', reason: 'smtp', error };
    }
    return { outcome: 'sent' };
  }

  /** Counts and logs one email by its parcel and how it ended: never by its address, its subject or the parcel's name. */
  private record(claim: DeliveryEmailClaim, ending: Ending, reported: Set<string>): void {
    const reason = ending.outcome === 'sent' ? 'none' : ending.reason;
    recordDeliveryEmail(ending.outcome, reason);
    const error = ending.outcome === 'failed' ? ending.error : undefined;
    logOperationalEvent('delivery_email', {
      package_id: claim.packageId,
      stage: claim.stage,
      outcome: ending.outcome,
      reason,
      ...(error === undefined ? {} : { error_type: errorType(error) }),
      ...(error instanceof EmailSendError ? { error_code: error.code, smtp_status: error.smtpStatus } : {}),
    }, ending.outcome === 'failed' ? 'error' : 'info');
    // An outage fails every email of a run the same way: one report per kind of failure.
    if (error === undefined || reported.has(reason)) return;
    reported.add(reason);
    captureOperationalError(error, { component: 'delivery-email', operation: reason });
  }
}

/**
 * The email as it is sent. The two `List-Unsubscribe` headers give a mail app
 * its own "Unsubscribe": it posts to the address, which must be HTTPS (RFC
 * 8058). The others ask robots, such as out-of-office replies, not to answer.
 * The card travels inside the email, so nothing is fetched when it is read.
 */
export function deliveryEmail(address: string, content: DeliveryEmailContent, oneClickUrl: string): OutgoingEmail {
  return {
    to: address,
    subject: content.subject.replace(/\s+/g, ' ').trim(),
    text: content.text,
    html: content.html,
    headers: {
      ...(oneClickUrl.startsWith('https://') ? {
        'List-Unsubscribe': `<${oneClickUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      } : {}),
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
    inline: content.card
      ? [{ cid: DELIVERY_CARD_CID, filename: 'parcel.png', contentType: 'image/png', content: content.card }]
      : [],
  };
}

/** The service for this deployment, or null when it has no mail settings. A malformed set throws. */
export function deliveryEmailService(client: SupabaseServiceClient): DeliveryEmailService | null {
  const settings = emailSettings();
  return settings ? new DeliveryEmailService(client, settings) : null;
}
