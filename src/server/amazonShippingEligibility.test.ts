import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as detect } from '../../app/api/carriers/detect/route';
import { POST as add } from '../../app/api/packages/route';
import { AmazonShippingHistoryExpiredError, AmazonShippingNotFoundError, AmazonShippingTracker } from './amazonShipping';
import { SupabaseAuthenticator } from './auth';
import { SupabaseServiceClient, SupabaseUserClient } from './supabase';
import * as background from './background';
import * as observability from './observability';

const userId = '18000000-0000-0000-0000-000000000001';
const packageId = '18000000-0000-0000-0000-000000000002';
const request = (body: unknown, path = '/api/carriers/detect') => new NextRequest(`https://delivery.example${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer amazon-test' }, body: JSON.stringify(body),
});
const context = { params: Promise.resolve({}) };
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({ id: userId, email: null, authenticatedAt: null, sessionId: null });
  vi.spyOn(background, 'wakeSyncWorker').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Amazon public tracking eligibility', () => {
  it.each(['FR0000000001', 'DE0000000001', 'BE0000000001', 'UK0000000001', 'TBA000000000001'])('leaves %s blocked without logging an expected absence', async (trackingNumber) => {
    const fetch = vi.spyOn(AmazonShippingTracker.prototype, 'fetch').mockRejectedValue(new AmazonShippingNotFoundError());
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const response = await detect(request({ trackingNumber }), context);
    expect(await response.json()).toEqual({ trackingNumber, carrier: 'amazon-logistics', amazonShippingStatus: 'not-found' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });
  it.each(['available', 'expired'])('promotes a confirmed %s parcel', async (status) => {
    const fetch = vi.spyOn(AmazonShippingTracker.prototype, 'fetch');
    if (status === 'expired') fetch.mockRejectedValue(new AmazonShippingHistoryExpiredError());
    else fetch.mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit' });
    expect(await (await detect(request({ trackingNumber: 'FR0000000001' }), context)).json())
      .toEqual({ trackingNumber: 'FR0000000001', carrier: 'amazon-shipping', amazonShippingStatus: status });
  });
  it('keeps outages distinct from retail results and reports the actual error', async () => {
    const error = new Error('Timed out');
    vi.spyOn(AmazonShippingTracker.prototype, 'fetch').mockRejectedValue(error);
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    expect(await (await detect(request({ trackingNumber: 'FR0000000001' }), context)).json())
      .toMatchObject({ carrier: 'amazon-logistics', amazonShippingStatus: 'unavailable' });
    expect(report).toHaveBeenCalledWith(error, expect.objectContaining({ operation: 'eligibility' }));
  });
  it('does not accept a forged Shipping selection', async () => {
    vi.spyOn(AmazonShippingTracker.prototype, 'fetch').mockRejectedValue(new AmazonShippingNotFoundError());
    const create = vi.spyOn(SupabaseUserClient.prototype, 'createPackage');
    const response = await add(request({ trackingNumber: 'FR0000000001', carrier: 'amazon-shipping' }, '/api/packages'), context);
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('rechecks and persists a confirmed Shipping parcel', async () => {
    const fetch = vi.spyOn(AmazonShippingTracker.prototype, 'fetch').mockResolvedValue({ status: 'pending', current_stage: 'registered' });
    const create = vi.spyOn(SupabaseUserClient.prototype, 'createPackage').mockResolvedValue({ id: packageId, carrier: 'amazon-shipping' });
    vi.spyOn(SupabaseServiceClient.prototype, 'enqueueSyncJob').mockResolvedValue({ row: { id: 'job' }, queued: true });
    const response = await add(request({ trackingNumber: 'FR0000000001', carrier: 'amazon-shipping' }, '/api/packages'), context);
    expect(response.status).toBe(201);
    expect(fetch).toHaveBeenCalledWith('FR0000000001');
    expect(create).toHaveBeenCalledWith('FR0000000001', '', 'amazon-shipping', null, null);
  });
});
