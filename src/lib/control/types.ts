export const CONTROL_AGENT_KEY = 'bbd-folio-concierge' as const;
export const CONTROL_ACTIONS = ['status', 'start', 'stop', 'restart', 'prompt'] as const;

export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export interface AgentBinding {
  key: typeof CONTROL_AGENT_KEY;
  name: string;
  externalUserId: string;
  displayName: string;
}

export interface ControlConfig {
  controlToken: string;
  channelId: string;
  channelApiKey: string;
  webhookSecret: string;
  supabaseDbUrl: string;
  agent: AgentBinding;
}

export interface CommandRecord {
  id: string;
  agentKey: typeof CONTROL_AGENT_KEY;
  action: ControlAction;
  status: 'pending' | 'succeeded' | 'failed';
  promptDigest: string | null;
}
