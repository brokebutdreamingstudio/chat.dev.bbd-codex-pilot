import { ChannelDispatchError, type ChatDevChannelClient } from './channel-api';
import type { ControlRepository } from './repository';
import { assertSafePrompt, fingerprint, redactText } from './security';
import { CONTROL_ACTIONS, CONTROL_AGENT_KEY, type CommandRecord, type ControlAction, type ControlConfig } from './types';

export interface ControlCommandInput {
  agentKey: string;
  action: string;
  idempotencyKey: string;
  prompt?: unknown;
}

export interface ControlService {
  execute(input: ControlCommandInput): Promise<CommandRecord>;
}

export class ControlCommandError extends Error {
  constructor() {
    super('Control command dispatch failed');
    this.name = 'ControlCommandError';
  }
}

function isControlAction(action: string): action is ControlAction {
  return CONTROL_ACTIONS.includes(action as ControlAction);
}

function errorClass(error: unknown): string {
  return redactText(error instanceof ChannelDispatchError ? 'ChannelDispatchError' : 'ChannelNetworkError').text;
}

export function createControlService(
  config: ControlConfig,
  repository: ControlRepository,
  client: ChatDevChannelClient,
): ControlService {
  return {
    async execute(input) {
      if (input.agentKey !== CONTROL_AGENT_KEY) {
        throw new Error('Unsupported control agent');
      }
      if (!isControlAction(input.action)) {
        throw new Error('Unsupported control action');
      }
      if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) {
        throw new Error('Idempotency key is required');
      }

      const action = input.action;
      const existing = await repository.findCommandByIdempotencyKey(action, input.idempotencyKey);
      if (existing) {
        return existing;
      }

      let promptDigest: string | null = null;
      let prompt: string | undefined;
      if (action === 'prompt') {
        assertSafePrompt(input.prompt);
        prompt = input.prompt;
        promptDigest = fingerprint(prompt);
      } else if (input.prompt !== undefined) {
        throw new Error('Prompt is only supported for prompt commands');
      }

      let pending: CommandRecord;
      try {
        pending = await repository.createPendingCommand({
          action,
          idempotencyKey: input.idempotencyKey,
          promptDigest,
        });
      } catch (error) {
        const winner = await repository.findCommandByIdempotencyKey(action, input.idempotencyKey);
        if (winner) {
          return winner;
        }
        throw error;
      }

      try {
        await client.dispatch(action, config.agent, prompt);
        return await repository.completeCommand(pending.id, 'succeeded', null);
      } catch (error) {
        await repository.completeCommand(pending.id, 'failed', errorClass(error));
        throw new ControlCommandError();
      }
    },
  };
}
