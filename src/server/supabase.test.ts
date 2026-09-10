import { describe, expect, it, vi } from 'vitest';
import { SupabaseServiceClient, SupabaseUserClient } from './supabase';

describe('guarded tracking writes', () => {
  it('requests account-scoped automatic linking', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue(1);
    await expect(client.autoLinkPackages('owner')).resolves.toBe(1);
    expect(request).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/auto_link_package_tracking', {
      method: 'POST', body: { p_user_id: 'owner' },
    });
  });

  it('resolves an old parcel id after a merge', async () => {
    const client = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'delivery' }]);
    await expect(client.getPackage('origin')).resolves.toEqual({ id: 'delivery' });
    expect(decodeURIComponent(request.mock.calls[1][0])).toContain('carrier_data->>original_package_id=eq.origin');
  });

  it('loads persisted sync status and timestamps for scheduled carrier cooldowns', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue([]);
    await client.listActivePackages();
    const selected = new URL(`https://database.example${request.mock.calls[0][0]}`).searchParams.get('select')!.split(',');
    expect(selected).toEqual(expect.arrayContaining(['sync_status', 'last_synced_at', 'carrier']));
  });

  it('atomically submits events, cleanup and status with the configuration generation', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue(true);
    const parcel = { id: 'package-1', tracking_generation: 'generation-1' };
    const events = [{ stage: 'in_transit' }];
    await expect(client.applyTrackingSync(parcel, { sync_status: 'ok' }, events, ['REPORTED']))
      .resolves.toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/apply_tracking_sync', {
      method: 'POST',
      body: {
        p_package_id: 'package-1', p_tracking_generation: 'generation-1',
        p_values: { sync_status: 'ok' }, p_events: events, p_delete_descriptions: ['REPORTED'],
      },
    });
    request.mockResolvedValue(false);
    await expect(client.applyTrackingSync(parcel, { sync_status: 'error' })).resolves.toBe(false);
    await expect(client.applyTrackingSync({ id: 'package-1' }, {})).rejects.toThrow('generation');
  });

  it('loads generation and current stage for workers but not public package responses', async () => {
    const service = new SupabaseServiceClient('https://database.example', 'service-key');
    const user = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const serviceRequest = vi.spyOn(service, 'request').mockResolvedValue([]);
    const userRequest = vi.spyOn(user, 'request').mockResolvedValue([]);
    await service.getPackage('package-1');
    await user.getPackage('package-1');
    expect(decodeURIComponent(serviceRequest.mock.calls[0][0])).toContain('current_stage,tracking_generation');
    expect(userRequest.mock.calls[0][0]).not.toContain('tracking_generation');
  });

  it('always scopes batch status reads to the requesting owner', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue([]);
    await client.getSyncJobs(['job-1', 'job-2'], 'owner-1');
    const params = new URL(`https://database.example${request.mock.calls[0][0]}`).searchParams;
    expect(params.get('user_id')).toBe('eq.owner-1');
    expect(params.get('id')).toBe('in.(job-1,job-2)');
    expect(params.get('limit')).toBe('20');
  });
});

describe('tracking audit PostgREST client', () => {
  it('starts and transactionally completes a private sync attempt', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(true);

    await client.startSyncAttempt('attempt-1', {
      package_id: 'package-1',
      trigger: 'package',
      configured_carrier: 'dpd-fr',
    });
    await expect(client.completeSyncAttempt(
      'attempt-1',
      { outcome: 'waiting', completed_at: '2026-08-31T12:00:00Z', duration_ms: 10 },
      [{ sequence: 1, step: 'fetch', status: 'succeeded' }],
    )).resolves.toBe(true);

    expect(request).toHaveBeenNthCalledWith(1, '/rest/v1/tracking_sync_attempts', {
      method: 'POST',
      body: {
        id: 'attempt-1',
        package_id: 'package-1',
        trigger: 'package',
        configured_carrier: 'dpd-fr',
      },
      prefer: 'return=minimal',
    });
    expect(request).toHaveBeenNthCalledWith(2, '/rest/v1/rpc/complete_tracking_sync_attempt', {
      method: 'POST',
      body: {
        p_attempt_id: 'attempt-1',
        p_values: {
          outcome: 'waiting',
          completed_at: '2026-08-31T12:00:00Z',
          duration_ms: 10,
        },
        p_steps: [{ sequence: 1, step: 'fetch', status: 'succeeded' }],
      },
    });
  });

  it('returns audit maintenance counts', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    vi.spyOn(client, 'request').mockResolvedValue([{ abandoned: 2, purged: 7 }]);

    await expect(client.maintainSyncAudit()).resolves.toEqual({ abandoned: 2, purged: 7 });
  });
});

describe('owner package PostgREST client', () => {
  it('looks up duplicates by normalized tracking number', async () => {
    const client = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const request = vi.spyOn(client, 'request').mockResolvedValue([{ id: 'package-1' }]);

    await expect(client.getPackageByTrackingNumber('FR3182317025'))
      .resolves.toEqual({ id: 'package-1' });

    expect(request).toHaveBeenCalledWith(expect.stringMatching(
      /^\/rest\/v1\/packages\?select=.*&tracking_number=eq\.FR3182317025&limit=1$/,
    ));
  });

  it('changes carriers through the owner-scoped reset RPC', async () => {
    const client = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const request = vi.spyOn(client, 'request').mockResolvedValue(true);

    await expect(client.changePackageCarrier(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'mondial-relay',
      null,
      '59650',
    )).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith('/rest/v1/rpc/change_owned_package_carrier', {
      method: 'POST',
      body: {
        p_package_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        p_carrier: 'mondial-relay',
        p_tracking_url: null,
        p_dpd_postcode: '59650',
      },
    });
  });
});
