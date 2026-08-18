import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ControlRepository } from '../../src/lib/control/repository';
import type { ControlConfig } from '../../src/lib/control/types';
import { createCallbackPost } from '../../app/api/chatdev/callback/route';

const config: ControlConfig = {
  controlToken: 'control-token', channelId: 'channel-1', channelApiKey: 'channel-key', webhookSecret: 'webhook-secret', supabaseDbUrl: 'postgres://test',
  agent: { key: 'bbd-folio-concierge', name: 'bbd-folio-concierge', externalUserId: 'founder-1', displayName: 'BBD Control' },
};

type CallbackRepository = ControlRepository & { recordChannelEvent: Mock };

function repository(inserted = true): CallbackRepository {
  return {
    createPendingCommand: vi.fn(), completeCommand: vi.fn(), findCommandByIdempotencyKey: vi.fn(),
    recordChannelEvent: vi.fn().mockResolvedValue(inserted),
    getAgentOverview: vi.fn(), deleteExpiredHistory: vi.fn(),
  } as unknown as CallbackRepository;
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

  it('atomically persists a redacted callback and projects it into agent state', async () => {
    const store = repository();
    const response = await createCallbackPost(config, store)(signedRequest(JSON.stringify(payload)));
    expect(response.status).toBe(204);
    expect(store.recordChannelEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        eventType: 'message.sent', redactedPayload: {
          event: 'message.sent', agentKey: 'bbd-folio-concierge', message: '[REDACTED]', groupExternalId: 'group-1',
        }, redactionCount: 1,
      }),
      state: { lifecycleStatus: 'message.sent', safeSummary: '[REDACTED]' },
    });
  });

  it('does not reproject an older duplicate callback', async () => {
    const store = repository(false);
    const response = await createCallbackPost(config, store)(signedRequest(JSON.stringify(payload)));
    expect(response.status).toBe(204);
    expect(store.recordChannelEvent).toHaveBeenCalledOnce();
  });

  it('retries the whole atomic callback write after a failed projection rolls back', async () => {
    const store = repository();
    store.recordChannelEvent.mockRejectedValueOnce(new Error('transient state failure')).mockResolvedValueOnce(true);
    const handler = createCallbackPost(config, store);

    expect((await handler(signedRequest(JSON.stringify(payload)))).status).toBe(500);
    expect((await handler(signedRequest(JSON.stringify(payload)))).status).toBe(204);
    expect(store.recordChannelEvent).toHaveBeenCalledTimes(2);
  });

  it('redacts retained event and group metadata as well as the message', async () => {
    const store = repository();
    const metadataPayload = {
      ...payload,
      event: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      groupExternalId: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln',
    };
    const response = await createCallbackPost(config, store)(signedRequest(JSON.stringify(metadataPayload)));

    expect(response.status).toBe(204);
    expect(store.recordChannelEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        eventType: '[REDACTED]',
        redactedPayload: {
          event: '[REDACTED]', agentKey: 'bbd-folio-concierge', message: '[REDACTED]', groupExternalId: '[REDACTED]',
        },
        redactionCount: 3,
      }),
      state: { lifecycleStatus: '[REDACTED]', safeSummary: '[REDACTED]' },
    });
  });

  it('rejects empty or overlong retained metadata', async () => {
    const store = repository();
    const emptyEvent = await createCallbackPost(config, store)(signedRequest(JSON.stringify({ ...payload, event: '' })));
    const longGroup = await createCallbackPost(config, store)(signedRequest(JSON.stringify({
      ...payload, groupExternalId: 'g'.repeat(257),
    })));

    expect(emptyEvent.status).toBe(400);
    expect(longGroup.status).toBe(400);
    expect(store.recordChannelEvent).not.toHaveBeenCalled();
  });

  it('rejects a mismatched callback identity', async () => {
    const store = repository();
    const response = await createCallbackPost(config, store)(signedRequest(JSON.stringify({ ...payload, channelId: 'other' })));
    expect(response.status).toBe(401);
    expect(store.recordChannelEvent).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before parsing', async () => {
    const response = await createCallbackPost(config, repository())(signedRequest('x'.repeat(128 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
  });

  it('rejects an oversized Content-Length before touching the request body', async () => {
    const request = {
      headers: new Headers({ 'Content-Length': String(128 * 1024 + 1) }),
      get body(): never { throw new Error('body must not be accessed'); },
      text(): never { throw new Error('body must not be buffered'); },
    } as unknown as Request;

    const response = await createCallbackPost(config, repository())(request);
    expect(response.status).toBe(413);
  });

  it('cancels a streamed body as soon as it crosses the byte limit', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() { cancelled = true; },
    });
    const request = {
      headers: new Headers(),
      body,
      text(): never { throw new Error('body must not be buffered'); },
    } as unknown as Request;

    const response = await createCallbackPost(config, repository())(request);
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
  });
});
