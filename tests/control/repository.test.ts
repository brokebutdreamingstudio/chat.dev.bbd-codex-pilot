import { describe, expect, it, vi } from 'vitest';
import { createControlRepository } from '../../src/lib/control/repository';

describe('control repository', () => {
  it('reuses the original command for the same action and idempotency key', async () => {
    // This catches an accidental lookup that omits the action or idempotency key.
    const db = {
      findCommand: vi.fn().mockResolvedValue({ id: 'cmd_1', status: 'pending' }),
    };
    const repository = createControlRepository(db as never);

    await expect(repository.findCommandByIdempotencyKey('status', 'key-1')).resolves.toMatchObject({
      id: 'cmd_1',
    });
    expect(db.findCommand).toHaveBeenCalledWith({
      agentKey: 'bbd-folio-concierge',
      action: 'status',
      idempotencyKey: 'key-1',
    });
  });

  it('turns database failures into a payload-free repository error', async () => {
    // This catches leaking a Supabase error's message or details to callers.
    const db = {
      findCommand: vi.fn().mockRejectedValue({ message: 'secret database payload', details: 'do not expose' }),
    };
    const repository = createControlRepository(db as never);

    await expect(repository.findCommandByIdempotencyKey('status', 'key-1')).rejects.toMatchObject({
      name: 'ControlRepositoryError',
      operation: 'findCommandByIdempotencyKey',
      message: 'Control repository operation failed: findCommandByIdempotencyKey',
    });
  });
});
