import type { MessageKey, Translate } from '../i18n';

/** Keep service diagnostics out of UI copy; known validation failures still get a useful next step. */
export function userErrorMessage(error: unknown, t: Translate, fallback: MessageKey = 'error.generic'): string {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const code = String(value.code ?? '').toLowerCase();
  const status = Number(value.status ?? value.statusCode);
  if (value.name === 'ApiAuthenticationError' || status === 401 || status === 403) return t('error.signIn');
  if (status === 429 || /rate.?limit|too many requests|over_email_send_rate_limit/.test(message + code)) {
    return t('error.rateLimited');
  }
  if (/otp_expired|invalid.*(?:code|token)|(?:code|token).*expired/.test(message + code)) return t('error.invalidCode');
  if (/email.*(?:invalid|valid)|invalid.*email/.test(message)) return t('error.invalidEmail');
  if (/postcode|postal code/.test(message)) return t('error.postcode');
  if (/tracking.*(?:url|link)|complete.*link/.test(message)) return t('error.trackingLink');
  if (/tracking (?:number|input)|parcel number/.test(message)) return t('error.trackingNumber');
  if (/80 characters|label.*long/.test(message)) return t('error.nameTooLong');
  if (/notifications were not allowed/.test(message) || value.name === 'NotAllowedError') {
    return t('notifications.state.blocked');
  }
  if (/failed to fetch|fetch failed|network|offline|load failed/.test(message)) return t('error.connection');
  return t(fallback);
}
