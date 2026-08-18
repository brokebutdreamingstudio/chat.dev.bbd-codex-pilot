import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ControlRepository } from '../../src/lib/control/repository';
import type { ControlConfig } from '../../src/lib/control/types';
import { createCallbackPost } from '../../app/api/chatdev/callback/route';

const config: ControlConfig = {
  controlToken: 'control-token', channelId: 'channel-1', channelApiKey: 'channel-key', webhookSecret: 'webhook-secret', supabaseDbUrl: 'postgres://test',
  agent: { key: 'bbd-folio-concierge', name: 'bbd-folio-concierge', externalUserId: 'founder-1', displayName: 'BBD Control' },
};

function repository(inserted = true): ControlRepository {
  return {
    createPendingCommand: vi.fn(), completeCommand: vi.fn(), findCommandByIdempotencyKey: vi.fn(),
    upsertAgentState: vi.fn(), insertChannelEvent: vi.fn().mockResolvedValue(inserted),
    getAgentOverview: vi.fn(), deleteExpiredHistory: vi.fn(),
  };
}

function signedRequest(body: string): Request {
  return new Request('http://localhost/api/chatdev/callback', {
    method: 'POST', body,
    headers: { 'X-Webhook-Signature': createHmac('sha256', config.webhookSecret).update(body).digest('hex') },
  });
}

const payload = { event: 'message.sent', channelId: 'channel-1', externalUserId: 'founder-1', message: 'Bearer super-secret-token', groupExternalId: 'group-1' };

describe('chat.dev callback', () => {
  it('rejects an invalid callback before JSON parsing', async () => {
    const response = await createCallbackPost(config, repository())(new Request('http://localhost/api/chatdev/callback', {
      method: 'POST', body: '{not-json}', headers: { 'X-Webhook-Signature': 'invalid' },
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('persists only a redacted callback and projects it into agent state', async () => {
    const store = repository();
    const response = await createCallbackPost(config, store)(signedRequest(JSON.stringify(payload)));
    expect(response.status).toBe(204);
    expect(store.insertChannelEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'message.sent', redactedPayload: {
        event: 'message.sent', agentKey: 'bbd-folio-concierge', message: '[REDACTED]', groupExternalId: 'group-1',
      }, redactionCount: 1,
    }));
    expect(store.upsertAgentState).toHaveBeenCalledWith({ lifecycleStatus: 'message.sent', safeSummary: '[REDACTED]' });
  });

  it('does not project or insert a duplicate callback twice', async () => {
    const store = repository(false);
    const response = await createCallbackPost(config, store)(signedRequest(JSON.stringify(payload)));
    expect(response.status).toBe(204);
    expect(store.insertChannelEvent).toHaveBeenCalledOnce();
    expect(store.upsertAgentState).not.toHaveBeenCalled();
  });

  it('rejects a mismatched callback identity', async () => {
    const store = repository();
    const response = await createCallbackPost(config, store)(signedRequest(JSON.stringify({ ...payload, channelId: 'other' })));
    expect(response.status).toBe(401);
    expect(store.insertChannelEvent).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before parsing', async () => {
    const response = await createCallbackPost(config, repository())(signedRequest('x'.repeat(128 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
  });
});
