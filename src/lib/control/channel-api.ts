import type { AgentBinding, ControlAction, ControlConfig } from './types';

export interface ChannelDispatchResult {
  ok: boolean;
  statusCode: number;
}

export interface ChatDevChannelClient {
  dispatch(
    action: ControlAction,
    binding: AgentBinding,
    prompt?: string,
  ): Promise<ChannelDispatchResult>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ChannelDispatchError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`Channel command failed with status ${statusCode}`);
    this.name = 'ChannelDispatchError';
    this.statusCode = statusCode;
  }
}

export function createChatDevChannelClient(
  config: ControlConfig,
  fetcher: Fetcher = fetch,
): ChatDevChannelClient {
  return {
    async dispatch(action, binding, prompt) {
      const endpoint = new URL(
        `/api/channels/${config.channelId}/commands/${action}`,
        'https://chat.dev',
      );
      const body = action === 'prompt'
        ? {
            externalUserId: binding.externalUserId,
            displayName: binding.displayName,
            prompt,
          }
        : {
            externalUserId: binding.externalUserId,
            displayName: binding.displayName,
            agentName: binding.name,
          };
      const response = await fetcher(endpoint.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.channelApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new ChannelDispatchError(response.status);
      }

      return { ok: true, statusCode: response.status };
    },
  };
}
