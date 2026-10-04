import { describe, expect, it, vi } from 'vitest';
import { STORED_EVENT_IDENTITIES, SupabaseError, SupabaseServiceClient, SupabaseUserClient } from './supabase';

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

  it('loads persisted sync status and timestamps for scheduled carrier cooldowns and idle back-off', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue([]);
    await client.listActivePackages();
    const selected = new URL(`https://database.example${request.mock.calls[0][0]}`).searchParams.get('select')!.split(',');
    expect(selected).toEqual(expect.arrayContaining(['sync_status', 'last_synced_at', 'carrier', 'created_at', 'carrier_data']));
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
    expect(decodeURIComponent(serviceRequest.mock.calls[0][0])).toContain('tracking_generation,user_id');
    expect(userRequest.mock.calls[0][0]).not.toContain('user_id');
  });

  it('gives only the sync loaders the stored event identities, under their own alias', async () => {
    const service = new SupabaseServiceClient('https://database.example', 'service-key');
    const user = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const serviceRequest = vi.spyOn(service, 'request').mockResolvedValue([]);
    const userRequest = vi.spyOn(user, 'request').mockResolvedValue([]);
    const select = (request: typeof serviceRequest, index: number) => new URL(
      `https://database.example${request.mock.calls[index]![0]}`,
    ).searchParams.get('select')!;
    await service.getPackage('package-1');
    await service.listActivePackages();
    await user.getPackage('package-1');
    await user.listPackages();
    await user.listActivePackages();

    const identities = `${STORED_EVENT_IDENTITIES}:tracking_events(provider_event_id,occurred_at,stage,description,location,provider_code:raw_data->>provider_code,observed_without_provider_timestamp:raw_data->observed_without_provider_timestamp)`;
    expect(select(serviceRequest, 0).endsWith(`,${identities}`)).toBe(true);
    expect(select(serviceRequest, 1).endsWith(`,${identities}`)).toBe(true);
    // The API's package shape never names provider_event_id, nor when the parcel joined its account.
    const apiShape = 'id,tracking_number,label,carrier,created_at,expected_delivery,last_status_text,'
      + 'last_synced_at,sync_status,sync_error,tracking_url,dpd_postcode,carrier_data,archived_at,'
      + 'notifications_muted,email_muted,tracking_events(id,package_id,stage,description,location,occurred_at,point:raw_data->point)';
    expect(select(userRequest, 0)).toBe(apiShape);
    expect(select(userRequest, 1)).toBe(apiShape);
    expect(select(userRequest, 2)).not.toContain('provider_event_id');
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

describe('one-off parcels and their links', () => {
  const service = () => new SupabaseServiceClient('https://database.example', 'service-key');
  const params = (path: unknown) => new URL(`https://database.example${String(path)}`).searchParams;

  it('keeps one-off parcels out of the account candidates and the auto-archive', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValue([]);
    await client.listActivePackages();
    expect(params(request.mock.calls[0][0]).get('one_off')).toBe('is.false');
    await client.archiveDeliveredBefore(new Date('2026-08-03T00:00:00Z'));
    expect(params(request.mock.calls[1][0]).get('one_off')).toBe('is.false');
    expect(params(request.mock.calls[1][0]).get('current_stage')).toBe('eq.delivered');
  });

  it('lists the one-off parcels a scheduled run follows in the shape of the other candidates', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValue([{ id: 'one-off', one_off: true }]);
    await expect(client.listFollowedOneOffPackages(new Date('2026-10-01T10:00:00Z'))).resolves.toEqual([{ id: 'one-off', one_off: true }]);
    const [path, options] = request.mock.calls[0];
    expect(path).toMatch(/^\/rest\/v1\/rpc\/followed_one_off_packages\?/);
    expect(options).toEqual({ method: 'POST', body: { p_opened_since: '2026-10-01T10:00:00.000Z' } });
    await client.listActivePackages();
    expect(params(path).get('select')).toBe(params(request.mock.calls[1][0]).get('select'));
    expect(params(path).get('order')).toBe('last_synced_at.asc.nullsfirst,created_at.asc');
  });

  it('lists the parcels nobody is waiting for, and records that an account read its parcels', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValue([{ id: 'quiet-1' }, { id: 'quiet-2' }, { id: null }]);
    await expect(client.listUnwatchedPackageIds(new Date('2026-10-01T10:00:00Z'))).resolves.toEqual(['quiet-1', 'quiet-2']);
    expect(request).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/unwatched_package_ids', {
      method: 'POST', body: { p_opened_since: '2026-10-01T10:00:00.000Z' },
    });
    const account = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const recorded = vi.spyOn(account, 'request').mockResolvedValue(null);
    await account.recordOpened();
    expect(recorded).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/record_account_opened', { method: 'POST', body: {} });
  });

  it('reads when an account\'s apps last read its parcels, for its export', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce([{ last_opened_at: '2026-10-03T21:05:00+00:00' }]).mockResolvedValue([]);
    await expect(client.accountLastOpened('owner-1')).resolves.toBe('2026-10-03T21:05:00+00:00');
    expect(params(request.mock.calls[0][0]).get('user_id')).toBe('eq.owner-1');
    expect(String(request.mock.calls[0][0])).toMatch(/^\/rest\/v1\/account_activity\?/);
    // An account whose read was never recorded.
    await expect(client.accountLastOpened('owner-2')).resolves.toBeNull();
  });

  it('queues a one-off parcel\'s check without an owner, behind accounts and the scheduled run', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValue([{ id: 'job' }]);
    await expect(client.enqueueSyncJob({ packageId: 'package-1' })).resolves.toEqual({ row: { id: 'job' }, queued: true });
    await client.enqueueSyncJob({ userId: 'owner-1', packageId: 'package-1' });
    await client.enqueueSyncJob({ scheduled: true });
    const queued = request.mock.calls.map(([, options]) => options!.body as Record<string, unknown>);
    expect(queued[0]).toEqual({ user_id: null, package_id: 'package-1', kind: 'package', dedupe_key: 'package:package-1', priority: -20 });
    expect(queued[1]).toMatchObject({ user_id: 'owner-1', priority: 10 });
    expect(queued[2]).toMatchObject({ kind: 'scheduled', priority: -10 });
    expect(queued[0].priority).toBeLessThan(queued[2].priority as number);
    await expect(client.enqueueSyncJob({ userId: 'owner-1' })).rejects.toThrow('require a package');
    await expect(client.enqueueSyncJob({ scheduled: true, packageId: 'package-1' })).rejects.toThrow('cannot target');
  });

  it('sends link ids and key hashes in request bodies, never in an address', async () => {
    const client = service();
    const user = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const hash = 'a'.repeat(64);
    const found = { link: { id: 'k7Qm2xHd9RtW' }, package: { id: 'package-1' } };
    const request = vi.spyOn(client, 'request')
      .mockResolvedValueOnce(found).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...found, created: true })
      .mockResolvedValueOnce({ links: 1, packages: 1 }).mockResolvedValueOnce({ links: 3, packages: 2 })
      .mockResolvedValueOnce({ allowed: false, scope: 'global', remaining: 4, overall: 3_000 })
      .mockResolvedValueOnce({ buckets: 4, p50: 2, p90: 10, max: 10, detection: { buckets: 2, p50: 4, p90: 8, max: 8 } });
    const userRequest = vi.spyOn(user, 'request').mockResolvedValue({ outcome: 'kept', package_id: 'package-2' });

    await expect(client.publicParcel('k7Qm2xHd9RtW', hash, true)).resolves.toEqual(found);
    await expect(client.publicParcel('k7Qm2xHd9RtW', null, false)).resolves.toBeNull();
    await expect(client.createOneOffParcel({ trackingNumber: 'TEST1234', carrier: 'unknown', trackingUrl: null, dpdPostcode: null }, hash))
      .resolves.toEqual({ ...found, created: true });
    await expect(client.forgetParcelLink('k7Qm2xHd9RtW', hash)).resolves.toEqual({ links: 1, packages: 1 });
    await expect(client.forgetExpiredParcelLinks()).resolves.toEqual({ links: 3, packages: 2, stopped: 0, alerts: 0 });
    await expect(client.claimPublicAllowance({
      bucket: hash, limit: 15, overall: { bucket: 'global', limit: 3_000 }, network: { bucket: `network:${hash}`, limit: 150 },
    })).resolves.toEqual({ allowed: false, scope: 'global', overallUsed: 3_000 });
    await expect(client.publicLookupUsageSummary()).resolves.toEqual({
      buckets: 4, p50: 2, p90: 10, max: 10, detection: { buckets: 2, p50: 4, p90: 8, max: 8 },
    });
    await expect(user.claimParcelLink('k7Qm2xHd9RtW', hash, 'Sneakers')).resolves.toEqual({ outcome: 'kept', packageId: 'package-2' });

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/rest/v1/rpc/parcel_link_view', '/rest/v1/rpc/parcel_link_view', '/rest/v1/rpc/create_one_off_parcel',
      '/rest/v1/rpc/forget_parcel_link', '/rest/v1/rpc/forget_expired_parcel_links',
      '/rest/v1/rpc/claim_public_lookup', '/rest/v1/rpc/public_lookup_usage_summary',
    ]);
    expect(request.mock.calls[0][1]).toEqual({ method: 'POST', body: { p_link_id: 'k7Qm2xHd9RtW', p_owner_key_hash: hash, p_touch: true } });
    expect(request.mock.calls[2][1]).toEqual({ method: 'POST', body: {
      p_tracking_number: 'TEST1234', p_carrier: 'unknown', p_tracking_url: null, p_dpd_postcode: null, p_owner_key_hash: hash,
    } });
    expect(request.mock.calls[5][1]).toEqual({ method: 'POST', body: {
      p_bucket: hash, p_limit: 15, p_global_bucket: 'global', p_global_limit: 3_000, p_network_bucket: `network:${hash}`, p_network_limit: 150,
    } });
    expect(userRequest).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/claim_parcel_link', {
      method: 'POST', body: { p_link_id: 'k7Qm2xHd9RtW', p_owner_key_hash: hash, p_label: 'Sneakers' },
    });
  });

  it('tells a stopped link from an unknown one, and counts what the maintenance pass ended', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request')
      .mockResolvedValueOnce({ stopped: true })
      .mockResolvedValueOnce({ link: { id: 'k7Qm2xHd9RtW' } })
      .mockResolvedValueOnce({ links: 1, packages: 1, stopped: 2, alerts: 3 });
    await expect(client.publicParcel('k7Qm2xHd9RtW', null, true)).resolves.toBe('stopped');
    await expect(client.publicParcel('k7Qm2xHd9RtW', null, true)).rejects.toThrow('parcel link');
    await expect(client.forgetExpiredParcelLinks()).resolves.toEqual({ links: 1, packages: 1, stopped: 2, alerts: 3 });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('changes a link and its alerts through functions, with ids, key hashes and endpoints in request bodies', async () => {
    const client = service();
    const hash = 'a'.repeat(64);
    const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-alert';
    const found = { link: { id: 'k7Qm2xHd9RtW', owner: true }, package: { id: 'package-1' } };
    const request = vi.spyOn(client, 'request')
      .mockResolvedValueOnce({ ...found, transition: 'stopped' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('added')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('renamed')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const alert = { endpoint, p256dh: 'synthetic-key', auth: 'synthetic-auth', locale: 'fr', preset: 'important' };

    await expect(client.updateParcelLink('k7Qm2xHd9RtW', hash, { shared: false })).resolves.toEqual({ ...found, transition: 'stopped' });
    await expect(client.updateParcelLink('k7Qm2xHd9RtW', hash, { showNumber: true, gift: false })).resolves.toBeNull();
    await expect(client.addParcelLinkAlert('k7Qm2xHd9RtW', null, alert)).resolves.toBe('added');
    await expect(client.addParcelLinkAlert('k7Qm2xHd9RtW', hash, alert)).resolves.toBeNull();
    await expect(client.addParcelLinkAlert('k7Qm2xHd9RtW', hash, alert)).rejects.toThrow('alert');
    await expect(client.removeParcelLinkAlert('k7Qm2xHd9RtW', endpoint)).resolves.toBe(true);
    await expect(client.removeParcelLinkAlert('k7Qm2xHd9RtW', endpoint)).resolves.toBe(false);

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/rest/v1/rpc/update_parcel_link', '/rest/v1/rpc/update_parcel_link', '/rest/v1/rpc/add_parcel_link_alert',
      '/rest/v1/rpc/add_parcel_link_alert', '/rest/v1/rpc/add_parcel_link_alert',
      '/rest/v1/rpc/remove_parcel_link_alert', '/rest/v1/rpc/remove_parcel_link_alert',
    ]);
    // A value left out is sent as null: the database keeps what it has.
    expect(request.mock.calls[0][1]).toEqual({ method: 'POST', body: {
      p_link_id: 'k7Qm2xHd9RtW', p_owner_key_hash: hash, p_show_number: null, p_gift: null, p_shared: false,
    } });
    expect(request.mock.calls[1][1]!.body).toMatchObject({ p_show_number: true, p_gift: false, p_shared: null });
    expect(request.mock.calls[2][1]).toEqual({ method: 'POST', body: {
      p_link_id: 'k7Qm2xHd9RtW', p_owner_key_hash: null, p_endpoint: endpoint, p_p256dh: 'synthetic-key',
      p_auth: 'synthetic-auth', p_locale: 'fr', p_preset: 'important',
    } });
    expect(request.mock.calls[5][1]).toEqual({ method: 'POST', body: { p_link_id: 'k7Qm2xHd9RtW', p_endpoint: endpoint } });
  });

  it('reads the alert queue, and records what an alert handled by its id', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValue([{ alert_id: 'alert-1' }]);
    await expect(client.listPendingParcelLinkAlerts()).resolves.toEqual([{ alert_id: 'alert-1' }]);
    await client.recordParcelLinkAlertDeliveries('alert-1', ['event-1', 'event-2']);
    await client.recordParcelLinkAlertDeliveries('alert-1', []);
    await client.setParcelLinkAlertFailures('alert-1', 2);
    await client.deleteParcelLinkAlert('alert-1');
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[0][0]).toMatch(/^\/rest\/v1\/pending_parcel_link_alerts\?/);
    expect(params(request.mock.calls[0][0]).get('order')).toBe('event_created_at.asc');
    expect(request.mock.calls[1]).toEqual(['/rest/v1/parcel_link_alert_deliveries?on_conflict=alert_id%2Cevent_id', {
      method: 'POST',
      body: [{ alert_id: 'alert-1', event_id: 'event-1' }, { alert_id: 'alert-1', event_id: 'event-2' }],
      prefer: 'resolution=ignore-duplicates,return=minimal',
    }]);
    expect(request.mock.calls[2]).toEqual(['/rest/v1/parcel_link_alerts?id=eq.alert-1', {
      method: 'PATCH', body: { failures: 2 }, prefer: 'return=minimal',
    }]);
    expect(request.mock.calls[3]).toEqual(['/rest/v1/parcel_link_alerts?id=eq.alert-1', { method: 'DELETE', prefer: 'return=minimal' }]);
  });

  it('shares an account\'s parcel under its own token, and reads another account\'s as missing', async () => {
    const user = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const stored = { id: 'k7Qm2xHd9RtW', show_number: true, gift: false, created_at: '2026-10-02T08:00:00+00:00' };
    const share = { id: 'k7Qm2xHd9RtW', showNumber: true, gift: false, createdAt: '2026-10-02T08:00:00+00:00' };
    const request = vi.spyOn(user, 'request')
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...stored, created: true })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(user.packageShare('package-1')).resolves.toEqual(share);
    await expect(user.packageShare('package-1')).resolves.toBeNull();
    await expect(user.sharePackage('package-1', { gift: false })).resolves.toEqual({ ...share, created: true });
    await expect(user.stopPackageShare('package-1')).resolves.toBe(true);
    await expect(user.stopPackageShare('package-1')).resolves.toBe(false);
    expect(request.mock.calls).toEqual([
      ['/rest/v1/rpc/owned_package_share', { method: 'POST', body: { p_package_id: 'package-1' } }],
      ['/rest/v1/rpc/owned_package_share', { method: 'POST', body: { p_package_id: 'package-1' } }],
      ['/rest/v1/rpc/share_owned_package', { method: 'POST', body: { p_package_id: 'package-1', p_show_number: null, p_gift: false } }],
      ['/rest/v1/rpc/stop_owned_package_share', { method: 'POST', body: { p_package_id: 'package-1' } }],
      ['/rest/v1/rpc/stop_owned_package_share', { method: 'POST', body: { p_package_id: 'package-1' } }],
    ]);

    for (const call of [
      () => user.packageShare('package-2'), () => user.sharePackage('package-2', {}), () => user.stopPackageShare('package-2'),
    ]) {
      request.mockRejectedValueOnce(new SupabaseError('refused', 400, 'P0002'));
      await expect(call()).rejects.toMatchObject({ status: 404, message: 'Package not found' });
      request.mockRejectedValueOnce(new SupabaseError('database down', 503));
      await expect(call()).rejects.toMatchObject({ status: 503 });
    }
    request.mockResolvedValueOnce({ show_number: true });
    await expect(user.sharePackage('package-1', {})).rejects.toThrow('shared link');
  });

  it('reads a refused keep as an unknown link and passes other failures on', async () => {
    const user = new SupabaseUserClient('https://database.example', 'public-key', 'token');
    const request = vi.spyOn(user, 'request').mockRejectedValueOnce(new SupabaseError('refused', 500, 'P0002'));
    await expect(user.claimParcelLink('k7Qm2xHd9RtW', null, '')).resolves.toBeNull();
    request.mockRejectedValueOnce(new SupabaseError('database down', 503));
    await expect(user.claimParcelLink('k7Qm2xHd9RtW', null, '')).rejects.toThrow('database down');
    request.mockResolvedValueOnce({ outcome: 'stolen' });
    await expect(user.claimParcelLink('k7Qm2xHd9RtW', null, '')).rejects.toThrow('kept parcel');
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

  it('records status observations through the service-only function', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue(null);
    const observations = [{
      observation_key: 'a'.repeat(64),
      carrier: 'ctt',
      provider_code: '99',
      description_normalized: 'estado interno 99',
      language_guess: null,
      stage_source: 'none',
      chosen_stage: 'in_transit',
      package_id: 'package-1',
      provider_event_id: 'ctt:abc',
    }];

    await client.recordTrackingStatusObservations([]);
    expect(request).not.toHaveBeenCalled();
    await client.recordTrackingStatusObservations(observations);

    expect(request).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/record_tracking_status_observations', {
      method: 'POST',
      body: { p_observations: observations },
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

describe('delivery emails', () => {
  // Synthetic identifiers only.
  const owner = '5b000000-0000-4000-a000-000000000001';
  const parcel = '5b000000-0000-4000-a000-000000000002';
  const service = () => new SupabaseServiceClient('https://database.example', 'service-key');
  const user = () => new SupabaseUserClient('https://database.example', 'public-key', 'token');

  it('claims what must be sent now in one call, with the allowances', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValue({
      send: [
        { id: 'claim-1', package_id: parcel, user_id: owner, event_id: 'scan-1', timezone: 'Europe/Paris', delivered_time: 'date' },
        { id: 'claim-2', package_id: 'parcel-2', user_id: owner, event_id: 'scan-2', timezone: null, delivered_time: 'sometime' },
      ],
      account_cap: 2,
      service_cap: 1,
    });
    await expect(client.claimDeliveryEmails(20, 5, 80)).resolves.toEqual({
      send: [
        { id: 'claim-1', packageId: parcel, userId: owner, eventId: 'scan-1', timezone: 'Europe/Paris', deliveredTime: 'date' },
        // Without a time zone or a known kind of time, the email says less rather than something wrong.
        { id: 'claim-2', packageId: 'parcel-2', userId: owner, eventId: 'scan-2', timezone: 'Europe/Zurich', deliveredTime: 'none' },
      ],
      accountCap: 2,
      serviceCap: 1,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/claim_delivery_emails', {
      method: 'POST', body: { p_limit: 20, p_per_account: 5, p_per_day: 80 },
    });
    request.mockResolvedValue({ send: [] });
    await expect(client.claimDeliveryEmails(20, 5, 80)).resolves.toEqual({ send: [], accountCap: 0, serviceCap: 0 });
    for (const unexpected of [null, [], { send: 'none' }]) {
      request.mockResolvedValue(unexpected);
      await expect(client.claimDeliveryEmails(20, 5, 80)).rejects.toThrow('did not return the delivery emails');
    }
  });

  it('ends a claim with its outcome and a reason code', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(client.finishDeliveryEmail('claim-1', 'sent')).resolves.toBe(true);
    await expect(client.finishDeliveryEmail('claim-1', 'failed', 'smtp')).resolves.toBe(true);
    await expect(client.finishDeliveryEmail('claim-1', 'skipped', 'no_address')).resolves.toBe(false);
    expect(request.mock.calls).toEqual([
      ['/rest/v1/rpc/finish_delivery_email', { method: 'POST', body: { p_id: 'claim-1', p_status: 'sent', p_reason: null } }],
      ['/rest/v1/rpc/finish_delivery_email', { method: 'POST', body: { p_id: 'claim-1', p_status: 'failed', p_reason: 'smtp' } }],
      ['/rest/v1/rpc/finish_delivery_email', { method: 'POST', body: { p_id: 'claim-1', p_status: 'skipped', p_reason: 'no_address' } }],
    ]);
  });

  it('switches an account\'s email by its id, sent in the body', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValue(null);
    await expect(client.setDeliveryEmail(owner, false)).resolves.toBe(false);
    await expect(client.setDeliveryEmail(owner, true)).resolves.toBe(true);
    // No such account.
    await expect(client.setDeliveryEmail(owner, false)).resolves.toBeNull();
    expect(request.mock.calls[0]).toEqual(['/rest/v1/rpc/set_delivery_email', { method: 'POST', body: { p_user_id: owner, p_enabled: false } }]);
    expect(request.mock.calls.every(([path]) => !String(path).includes(owner))).toBe(true);
  });

  it('reads what an email to an account needs from the Auth server', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValue({
      id: owner, email: 'alex@example.com', email_confirmed_at: '2026-09-01T08:00:00Z',
      user_metadata: { locale: 'fr', name: 'never read' }, app_metadata: { provider: 'email' },
    });
    await expect(client.getAuthAccount(owner)).resolves.toEqual({ email: 'alex@example.com', emailConfirmed: true, locale: 'fr' });
    expect(request).toHaveBeenCalledExactlyOnceWith(`/auth/v1/admin/users/${owner}`);
    request.mockResolvedValue({ id: owner, email: 'alex@example.com', email_confirmed_at: null, user_metadata: null });
    await expect(client.getAuthAccount(owner)).resolves.toEqual({ email: 'alex@example.com', emailConfirmed: false, locale: null });
    request.mockResolvedValue({ id: owner, email: '', user_metadata: { locale: 42 } });
    await expect(client.getAuthAccount(owner)).resolves.toEqual({ email: null, emailConfirmed: false, locale: null });
    // An account that is gone, and an answer that is not an account.
    request.mockRejectedValueOnce(new SupabaseError('Supabase GET request failed (404)', 404));
    await expect(client.getAuthAccount(owner)).resolves.toBeNull();
    request.mockResolvedValue({ users: [] });
    await expect(client.getAuthAccount(owner)).resolves.toBeNull();
    // The Auth server not answering is a failure, not a missing account.
    request.mockRejectedValue(new SupabaseError('Supabase GET request failed (503)', 503));
    await expect(client.getAuthAccount(owner)).rejects.toThrow('503');
  });

  it('loads an account\'s parcel in the shape the API gives its owner', async () => {
    const client = service();
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce([{ id: parcel }]).mockResolvedValue([]);
    await expect(client.getOwnedPackage(parcel, owner)).resolves.toEqual({ id: parcel });
    await expect(client.getOwnedPackage(parcel, owner)).resolves.toBeNull();
    const params = new URL(`https://database.example${request.mock.calls[0]![0]}`).searchParams;
    expect(params.get('id')).toBe(`eq.${parcel}`);
    expect(params.get('user_id')).toBe(`eq.${owner}`);
    const owned = user();
    const ownerRequest = vi.spyOn(owned, 'request').mockResolvedValue([{ id: parcel }]);
    await owned.getPackage(parcel);
    expect(params.get('select')).toBe(new URL(`https://database.example${ownerRequest.mock.calls[0]![0]}`).searchParams.get('select'));
    expect(params.get('select')).not.toContain('provider_event_id');
  });

  it('saves the email choice only when a request makes one', async () => {
    const client = user();
    const request = vi.spyOn(client, 'request').mockResolvedValue({ enabled_stages: ['delivered'], email_on_delivery: true });
    const base = { p_enabled_stages: ['delivered'], p_quiet_hours_start: null, p_quiet_hours_end: null, p_timezone: 'Europe/Zurich' };
    await client.setNotificationPreferences(['delivered'], null, null, 'Europe/Zurich');
    await client.setNotificationPreferences(['delivered'], null, null, 'Europe/Zurich', null);
    await client.setNotificationPreferences(['delivered'], null, null, 'Europe/Zurich', true);
    await client.setNotificationPreferences(['delivered'], null, null, 'Europe/Zurich', false);
    expect(request.mock.calls.map(([, options]) => options!.body)).toEqual([
      // The four arguments every server before this one sent: the stored choice stays.
      base, base, { ...base, p_email_on_delivery: true }, { ...base, p_email_on_delivery: false },
    ]);
  });

  it('reads the email choice with the preferences, and says never chosen without a row', async () => {
    const client = user();
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce([{ enabled_stages: ['delivered'], email_on_delivery: false }]).mockResolvedValue([]);
    await expect(client.getNotificationPreferences()).resolves.toMatchObject({ email_on_delivery: false });
    await expect(client.getNotificationPreferences()).resolves.toMatchObject({ email_on_delivery: null, timezone: 'Europe/Zurich' });
    expect(new URL(`https://database.example${request.mock.calls[0]![0]}`).searchParams.get('select'))
      .toBe('enabled_stages,quiet_hours_start,quiet_hours_end,timezone,email_on_delivery');
  });

  it('leaves a parcel out of the email through the owner-scoped RPC', async () => {
    const client = user();
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce(true).mockResolvedValue(false);
    await client.updatePackage(parcel, { email_muted: true });
    expect(request).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/set_owned_package_email_muted', {
      method: 'POST', body: { p_package_id: parcel, p_muted: true },
    });
    // Another account's parcel, or none.
    await expect(client.updatePackage(parcel, { email_muted: false })).rejects.toMatchObject({ status: 404 });
    for (const values of [{ email_muted: 'yes' }, { email_muted: true, notifications_muted: true }, { owned_since: '2026-10-03T00:00:00Z' }]) {
      await expect(client.updatePackage(parcel, values)).rejects.toThrow('approved mutation');
    }
  });

  it('lists the emails an account was sent, for its export', async () => {
    const client = user();
    const request = vi.spyOn(client, 'request').mockResolvedValue([
      { package_id: parcel, sent_at: '2026-10-03T12:13:00+00:00' },
      { package_id: null, sent_at: '2026-09-30T09:00:00+00:00' },
      { package_id: parcel, sent_at: null },
    ]);
    await expect(client.listDeliveryEmails()).resolves.toEqual([
      { packageId: parcel, sentAt: '2026-10-03T12:13:00+00:00' },
      { packageId: null, sentAt: '2026-09-30T09:00:00+00:00' },
    ]);
    expect(request).toHaveBeenCalledExactlyOnceWith('/rest/v1/rpc/owned_delivery_emails', { method: 'POST', body: {} });
  });
});
