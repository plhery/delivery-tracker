import type { ApiDeliveryEmailSwitchRequest, ApiDeliveryEmailSwitchResponse } from '../generated/apiContract';
import { authenticatedFetch } from './apiClient';

/** What a delivery email's opt-out token looks like. Anything else is not sent to the server. */
const TOKEN = /^[A-Za-z0-9._-]{20,200}$/;

/**
 * The token of an opt-out link, read from the `#t=<token>` of its address, or
 * null when there is none or it cannot be one. It stands after the `#` so that
 * opening the link tells no server and no log who it belongs to.
 */
export function deliveryEmailToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('t');
  return token !== null && TOKEN.test(token) ? token : null;
}

/** The server does not take the link's token: it was cut short, changed, or made elsewhere. */
export class DeliveryEmailLinkError extends Error {
  constructor() {
    super('This link does not work');
    this.name = 'DeliveryEmailLinkError';
  }
}

/**
 * Switches the delivery email of the account a link's token names, without a
 * sign-in, and answers what the server kept. The token travels in the body,
 * never in an address.
 */
export async function switchDeliveryEmail(token: string, enabled: boolean): Promise<boolean> {
  const body: ApiDeliveryEmailSwitchRequest = enabled ? { token, enabled } : { token };
  const response = await authenticatedFetch('/api/email/unsubscribe', undefined, {
    method: 'POST',
    body: JSON.stringify(body),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (response.status === 400) throw new DeliveryEmailLinkError();
  const answer = (await response.json().catch(() => null)) as Partial<ApiDeliveryEmailSwitchResponse> | null;
  if (!response.ok || typeof answer?.emailOnDelivery !== 'boolean') {
    throw new Error('The email setting could not be changed');
  }
  return answer.emailOnDelivery;
}
