import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlConfig } from '../../src/lib/control/types';

const { postgresFactory } = vi.hoisted(() => ({
  postgresFactory: vi.fn(() => Object.assign(vi.fn(), { json: vi.fn((value) => value) })),
}));

vi.mock('postgres', () => ({ default: postgresFactory }));

import { createControlRepository } from '../../src/lib/control/repository';

const config: ControlConfig = {
  controlToken: 'control-token',
  channelId: 'channel-1',
  channelApiKey: 'channel-key',
  webhookSecret: 'webhook-secret',
  supabaseDbUrl: 'postgres://test-user:test-password@example.test/postgres',
  agent: {
    key: 'bbd-folio-concierge',
    name: 'bbd-folio-concierge',
    externalUserId: 'founder-1',
    displayName: 'BBD Control',
  },
};

describe('Postgres repository pooling', () => {
  beforeEach(() => postgresFactory.mockClear());

  it('constructs one module-scoped pool for repeated route composition', () => {
    createControlRepository(config);
    createControlRepository(config);
    createControlRepository(config);

    expect(postgresFactory).toHaveBeenCalledOnce();
  });
});
