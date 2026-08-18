import { describe, expect, it, vi } from 'vitest';
import { createChatDevChannelClient } from '../../src/lib/control/channel-api';
import type { ControlConfig } from '../../src/lib/control/types';

const config: ControlConfig = {
  controlToken: 'control-token',
  channelId: 'ch_test',
  channelApiKey: 'channel-key',
  webhookSecret: 'webhook-secret',
  supabaseDbUrl: 'postgres://test-user:test-password@example.com:5432/postgres',
  agent: {
    key: 'bbd-folio-concierge',
    name: 'bbd-folio-concierge',
    externalUserId: 'bbd-founder-control',
    displayName: 'BBD Control',
  },
};

describe('ChatDev channel client', () => {
  it('uses only the prompt endpoint with fixed channel identity fields', async () => {
    // This catches sending a prompt to a generic or agent-controlled endpoint.
    const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const client = createChatDevChannelClient(config, fetcher);

    await client.dispatch('prompt', config.agent, 'summarise issue #2');

    expect(fetcher).toHaveBeenCalledWith(
      'https://chat.dev/api/channels/ch_test/commands/prompt',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      externalUserId: 'bbd-founder-control',
      displayName: 'BBD Control',
      prompt: 'summarise issue #2',
    });
  });

  it.each(['status', 'start', 'stop', 'restart'] as const)(
    'sends the fixed identity and agent name for %s',
    async (action) => {
      // This catches lifecycle dispatches that omit the allowlisted agent binding.
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const client = createChatDevChannelClient(config, fetcher);

      await client.dispatch(action, config.agent);

      expect(fetcher).toHaveBeenCalledWith(
        `https://chat.dev/api/channels/ch_test/commands/${action}`,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
        externalUserId: 'bbd-founder-control',
        displayName: 'BBD Control',
        agentName: 'bbd-folio-concierge',
      });
    },
  );

  it('exposes only the status code when a channel command fails', async () => {
    // This catches leaking a channel response body through the control boundary.
    const client = createChatDevChannelClient(
      config,
      vi.fn().mockResolvedValue(new Response('internal detail: do not expose', { status: 503 })),
    );

    await expect(client.dispatch('status', config.agent)).rejects.toMatchObject({
      name: 'ChannelDispatchError',
      statusCode: 503,
      message: 'Channel command failed with status 503',
    });
  });
});
