import { describe, expect, it } from 'vitest';
import { buildEvents } from './trackingSync';
describe('structured stages at the persistence boundary', () => {
  it.each(['Livré', 'Zugestellt', 'Consegnato', 'Entregado', 'Entregue'])('keeps a verified stage ahead of %s', description => {
    expect(buildEvents({ id: 'synthetic', carrier: 'swiss-post' }, {
      events: [{ time: '2026-01-01T12:00:00Z', description, stage: 'ready_for_pickup' }],
    })[0].stage).toBe('ready_for_pickup');
  });
});
