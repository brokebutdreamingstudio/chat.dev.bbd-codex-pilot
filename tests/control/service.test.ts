import { describe, expect, it, vi } from 'vitest';
import { createControlService } from '../../src/lib/control/service';
import type { ControlRepository } from '../../src/lib/control/repository';
import type { ChatDevChannelClient } from '../../src/lib/control/channel-api';
import type { ControlConfig, CommandRecord } from '../../src/lib/control/types';

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

function command(status: CommandRecord['status'] = 'pending'): CommandRecord {
  return {
    id: 'cmd_1',
    agentKey: 'bbd-folio-concierge',
    action: 'prompt',
    status,
    promptDigest: null,
  };
}

function repository(): ControlRepository {
  return {
    findCommandByIdempotencyKey: vi.fn().mockResolvedValue(null),
    createPendingCommand: vi.fn().mockResolvedValue(command()),
    completeCommand: vi.fn().mockResolvedValue(command('succeeded')),
  } as unknown as ControlRepository;
}

function channel(): ChatDevChannelClient {
  return { dispatch: vi.fn().mockResolvedValue({ ok: true, statusCode: 200 }) };
}

describe('control command service', () => {
  it('returns the existing command without dispatching again', async () => {
    // This catches dispatching a lifecycle command twice after an idempotent replay.
    const store = repository();
    const existing = command('succeeded');
    vi.mocked(store.findCommandByIdempotencyKey).mockResolvedValue(existing);
    const client = channel();
    const service = createControlService(config, store, client);

    await expect(
      service.execute({ agentKey: 'bbd-folio-concierge', action: 'prompt', idempotencyKey: 'key-1', prompt: 'hello' }),
    ).resolves.toEqual(existing);
    expect(client.dispatch).not.toHaveBeenCalled();
    expect(store.createPendingCommand).not.toHaveBeenCalled();
  });

  it('persists only a prompt fingerprint before dispatching once and completing it', async () => {
    // This catches persisting raw prompt content or retrying a lifecycle command.
    const store = repository();
    const client = channel();
    const service = createControlService(config, store, client);

    await service.execute({ agentKey: 'bbd-folio-concierge', action: 'prompt', idempotencyKey: 'key-2', prompt: 'summarise issue #2' });

    expect(store.createPendingCommand).toHaveBeenCalledWith({
      action: 'prompt',
      idempotencyKey: 'key-2',
      promptDigest: '305b68912eb9bcb49b37fff6ab6fb31bcdcb859d8b9cc769bb4b8374b033f43c',
    });
    expect(client.dispatch).toHaveBeenCalledTimes(1);
    expect(client.dispatch).toHaveBeenCalledWith('prompt', config.agent, 'summarise issue #2');
    expect(store.completeCommand).toHaveBeenCalledWith('cmd_1', 'succeeded', null);
  });

  it('fails a pending command without exposing channel response details', async () => {
    // This catches retaining a pending record or leaking a remote error body on failure.
    const store = repository();
    const client = { dispatch: vi.fn().mockRejectedValue(new Error('remote body: secret value')) };
    const service = createControlService(config, store, client);

    await expect(
      service.execute({ agentKey: 'bbd-folio-concierge', action: 'status', idempotencyKey: 'key-3' }),
    ).rejects.toMatchObject({ name: 'ControlCommandError', message: 'Control command dispatch failed' });
    expect(store.completeCommand).toHaveBeenCalledWith('cmd_1', 'failed', 'ChannelNetworkError');
  });

  it('rejects unknown actions at the public boundary', async () => {
    // This catches a runtime client bypass around the fixed action allowlist.
    const service = createControlService(config, repository(), channel());

    await expect(
      service.execute({ agentKey: 'bbd-folio-concierge', action: 'destroy' as never, idempotencyKey: 'key-4' }),
    ).rejects.toThrow('Unsupported control action');
  });

  it('rejects any agent other than the fixed binding', async () => {
    // This catches an agent-key override expanding the command surface.
    const service = createControlService(config, repository(), channel());

    await expect(
      service.execute({ agentKey: 'another-agent' as never, action: 'status', idempotencyKey: 'key-5' }),
    ).rejects.toThrow('Unsupported control agent');
  });
});
