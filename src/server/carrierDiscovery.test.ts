import { beforeEach, expect, it, vi } from 'vitest';
import { IndeterminateError } from 'universal-parcel-scraper';
import { detectCarrier } from './carrierDetection';
import { SupabaseServiceClient } from './supabase';
import { discoveryAskedCarriers } from '../lib/carriers';

const mocks = vi.hoisted(() => ({ http: vi.fn(), browser: vi.fn() }));
vi.mock('./adapterRegistry', () => ({ createAdapterRegistry: () => ({ for: (carrier: string) => ({
  recognize: (number: string, context: unknown) => mocks.http(carrier, number, context),
}) }) }));
vi.mock('./browserRecognition', () => ({ BROWSER_RECOGNITION_BUDGET_MS: 20_000, MAX_BROWSER_RECOGNITIONS: 2,
  recognizeBrowser: (...args: unknown[]) => mocks.browser(...args) }));
beforeEach(() => {
  mocks.http.mockReset().mockResolvedValue({ known: false });
  mocks.browser.mockReset().mockResolvedValue({ known: true, lastActivityAt: new Date().toISOString() });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

it('confirms FedEx after HTTP misses and charges the allowance once', async () => {
  const allowance = vi.fn();
  expect(await detectCarrier({ trackingNumber: '000000000011' }, allowance)).toEqual({
    trackingNumber: '000000000011', carrier: 'fedex', asked: discoveryAskedCarriers('000000000011'),
  });
  expect(allowance).toHaveBeenCalledOnce();
  expect(mocks.http).toHaveBeenCalledWith('colis-prive', '000000000011', expect.objectContaining({ budgetMs: 3_000, signal: expect.any(AbortSignal) }));
  expect(mocks.browser).toHaveBeenCalledWith('fedex', '000000000011', expect.objectContaining({ budgetMs: 20_000 }), undefined);
});

it('can ask a browser-only candidate without an HTTP recognizer', async () => {
  const answer = await detectCarrier({ trackingNumber: '000000000000017' });
  expect(answer.carrier).toBe('fedex');
  expect(mocks.browser).toHaveBeenCalledOnce();
});

it('keeps a successful HTTP confirmation fast', async () => {
  mocks.http.mockImplementation(async (carrier: string) => ({ known: carrier === 'colis-prive' }));
  expect(await detectCarrier({ trackingNumber: '000000000012' })).toMatchObject({ carrier: 'colis-prive' });
  expect(mocks.browser).not.toHaveBeenCalled();
});

it('passes an inconclusive regional error into browser recovery and reports the recovered answer', async () => {
  const error = new IndeterminateError('DHL eCommerce', 'Regional miss', { reason: 'webtrack_not_found' });
  mocks.http.mockRejectedValue(error);
  expect(await detectCarrier({ trackingNumber: '33870000000000011' })).toEqual({
    trackingNumber: '33870000000000011', carrier: 'dhl-ecommerce', asked: ['dhl-ecommerce'],
  });
  expect(mocks.browser).toHaveBeenCalledWith('dhl-ecommerce', '33870000000000011', expect.any(Object), error);
});

it('does not browser-retry a definite miss, and does not settle on an old reused number', async () => {
  expect(await detectCarrier({ trackingNumber: '33870000000000012' })).toMatchObject({ carrier: 'unknown' });
  expect(mocks.browser).not.toHaveBeenCalled();
  mocks.browser.mockResolvedValue({ known: true, lastActivityAt: '2020-01-01T00:00:00Z' });
  expect(await detectCarrier({ trackingNumber: '000000000013' })).toMatchObject({ carrier: 'unknown' });
});

it('stops before browser work when the caller cancels the HTTP check', async () => {
  const controller = new AbortController();
  const client = new SupabaseServiceClient('https://database.example', 'service-key');
  const retain = vi.spyOn(client, 'recordTrackingSupportObservation').mockResolvedValue(undefined);
  mocks.http.mockImplementation(() => { controller.abort(); return Promise.resolve({ known: false }); });
  await expect(detectCarrier({ trackingNumber: '000000000014' }, undefined, controller.signal, client)).rejects.toThrow();
  expect(mocks.browser).not.toHaveBeenCalled();
  expect(retain).not.toHaveBeenCalled();
});
