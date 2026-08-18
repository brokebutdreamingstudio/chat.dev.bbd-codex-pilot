import { describe, expect, it } from 'vitest';
import { parseControlConfig } from '../../src/lib/control/config';

const valid = {
  CONTROL_API_TOKEN: 'test-control-token',
  CHATDEV_CHANNEL_ID: 'ch_test',
  CHATDEV_CHANNEL_API_KEY: 'test-channel-key',
  CHATDEV_CHANNEL_WEBHOOK_SECRET: 'test-webhook-secret',
  CHATDEV_CONTROL_EXTERNAL_USER_ID: 'bbd-founder-control',
  CHATDEV_CONTROL_DISPLAY_NAME: 'BBD Control',
  CHATDEV_AGENT_NAME: 'bbd-folio-concierge',
  SUPABASE_DB_URL: 'postgres://test-user:test-password@example.com:5432/postgres',
};

describe('parseControlConfig', () => {
  it('returns exactly one fixed agent binding', () => {
    expect(parseControlConfig(valid).agent).toEqual({
      key: 'bbd-folio-concierge',
      name: 'bbd-folio-concierge',
      externalUserId: 'bbd-founder-control',
      displayName: 'BBD Control',
    });
  });

  it('rejects a missing database URL', () => {
    expect(() => parseControlConfig({ ...valid, SUPABASE_DB_URL: '' })).toThrow();
  });

  it('ignores unrelated Node and Vercel environment variables', () => {
    expect(parseControlConfig({
      ...valid,
      PATH: '/usr/local/bin:/usr/bin',
      VERCEL: '1',
      VERCEL_ENV: 'production',
      NODE_ENV: 'production',
    })).toMatchObject({
      controlToken: 'test-control-token',
      channelId: 'ch_test',
      agent: { key: 'bbd-folio-concierge' },
    });
  });
});
