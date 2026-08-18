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
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
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

  it('rejects a missing service-role key', () => {
    expect(() => parseControlConfig({ ...valid, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow();
  });
});
