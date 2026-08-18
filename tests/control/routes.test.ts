import { describe, expect, it, vi } from 'vitest';
import type { ControlConfig } from '../../src/lib/control/types';
import type { ControlRepository } from '../../src/lib/control/repository';
import type { ControlService } from '../../src/lib/control/service';
import { createAgentGet } from '../../app/api/control/agents/[agentKey]/route';
import { createAgentActionPost as createActionPost } from '../../app/api/control/agents/[agentKey]/[action]/route';

const config: ControlConfig = {
  controlToken: 'control-token',
  channelId: 'channel-1',
  channelApiKey: 'channel-key',
  webhookSecret: 'webhook-secret',
  supabaseDbUrl: 'postgres://test',
  agent: {
    key: 'bbd-folio-concierge',
    name: 'bbd-folio-concierge',
    externalUserId: 'founder-1',
    displayName: 'BBD Control',
  },
};

const overview = {
  agentState: null,
  lastCommand: null,
  events: [],
};

function repository(): ControlRepository {
  return {
    createPendingCommand: vi.fn(),
    completeCommand: vi.fn(),
    findCommandByIdempotencyKey: vi.fn(),
    recordChannelEvent: vi.fn(),
    getAgentOverview: vi.fn().mockResolvedValue(overview),
    deleteExpiredHistory: vi.fn(),
  };
}

function service(): ControlService {
  return {
    execute: vi.fn().mockResolvedValue({
      id: 'cmd-1',
      agentKey: 'bbd-folio-concierge',
      action: 'start',
      status: 'succeeded',
      promptDigest: null,
    }),
  };
}

describe('control routes', () => {
  it('rejects an unauthenticated command', async () => {
    const handler = createActionPost(config, service());
    const response = await handler(new Request('http://localhost/api/control/agents/bbd-folio-concierge/start', {
      method: 'POST', headers: { 'Idempotency-Key': 'test-1' },
    }), { params: Promise.resolve({ agentKey: 'bbd-folio-concierge', action: 'start' }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects an invalid agent key', async () => {
    const handler = createAgentGet(config, repository());
    const response = await handler(new Request('http://localhost/api/control/agents/nope', {
      headers: { Authorization: 'Bearer control-token' },
    }), { params: Promise.resolve({ agentKey: 'nope' }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('returns a sanitized overview for the fixed agent', async () => {
    const store = repository();
    const handler = createAgentGet(config, store);
    const response = await handler(new Request('http://localhost/api/control/agents/bbd-folio-concierge', {
      headers: { Authorization: 'Bearer control-token' },
    }), { params: Promise.resolve({ agentKey: 'bbd-folio-concierge' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(overview);
    expect(store.getAgentOverview).toHaveBeenCalledOnce();
  });

  it('rejects an unknown action', async () => {
    const handler = createActionPost(config, service());
    const response = await handler(new Request('http://localhost/api/control/agents/bbd-folio-concierge/nope', {
      method: 'POST', headers: { Authorization: 'Bearer control-token', 'Idempotency-Key': 'test-1' },
    }), { params: Promise.resolve({ agentKey: 'bbd-folio-concierge', action: 'nope' }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('rejects a missing idempotency key', async () => {
    const handler = createActionPost(config, service());
    const response = await handler(new Request('http://localhost/api/control/agents/bbd-folio-concierge/start', {
      method: 'POST', headers: { Authorization: 'Bearer control-token' },
    }), { params: Promise.resolve({ agentKey: 'bbd-folio-concierge', action: 'start' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('rejects a body on a lifecycle action', async () => {
    const control = service();
    const handler = createActionPost(config, control);
    const response = await handler(new Request('http://localhost/api/control/agents/bbd-folio-concierge/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer control-token', 'Idempotency-Key': 'test-1' },
      body: '{}',
    }), { params: Promise.resolve({ agentKey: 'bbd-folio-concierge', action: 'start' }) });
    expect(response.status).toBe(400);
    expect(control.execute).not.toHaveBeenCalled();
  });

  it('dispatches a prompt and returns only the command summary', async () => {
    const control = service();
    const handler = createActionPost(config, control);
    const response = await handler(new Request('http://localhost/api/control/agents/bbd-folio-concierge/prompt', {
      method: 'POST',
      headers: { Authorization: 'Bearer control-token', 'Idempotency-Key': 'test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'summarise issue 2' }),
    }), { params: Promise.resolve({ agentKey: 'bbd-folio-concierge', action: 'prompt' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'cmd-1', action: 'start', status: 'succeeded' });
    expect(control.execute).toHaveBeenCalledWith({
      agentKey: 'bbd-folio-concierge', action: 'prompt', idempotencyKey: 'test-1', prompt: 'summarise issue 2',
    });
  });
});
