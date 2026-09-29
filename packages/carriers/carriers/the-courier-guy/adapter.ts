import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeCourierGuyNumber, parseCourierGuy } from './parser';

const ENDPOINT = 'https://api.portal.thecourierguy.co.za/tracking/shipments';

export class CourierGuyTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeCourierGuyNumber(raw);
    return runSteps({ carrier: 'the-courier-guy', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const url = new URL(ENDPOINT);
      url.searchParams.set('tracking_reference', number);
      // Public provider identity returned by /providers for the official portal.
      url.searchParams.set('provider_id', '7');
      const { response, bytes } = await fetchBounded(url, { signal, headers: { Accept: 'application/json' } }, {
        provider: 'The Courier Guy', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
        allowHttpStatuses: [404, 410], fetcher: this.options.fetcher,
      });
      const body = decodeText(bytes);
      if (response.status === 404) {
        if (body === `could not find shipment or parcel with reference ${number}`) throw new NotFoundError('The Courier Guy');
        throw new IndeterminateError('The Courier Guy', 'Tracking endpoint unavailable');
      }
      if (response.status === 410) throw new IndeterminateError('The Courier Guy', 'Tracking endpoint unavailable');
      let payload: unknown;
      try { payload = JSON.parse(body); } catch { throw new SchemaError('The Courier Guy'); }
      return parseCourierGuy(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new CourierGuyTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'the-courier-guy', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
