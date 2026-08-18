import { createClient } from '@supabase/supabase-js';
import { CONTROL_AGENT_KEY, type ControlAction, type ControlConfig, type CommandRecord } from './types';

export type CommandStatus = CommandRecord['status'];

export interface AgentState {
  agentKey: typeof CONTROL_AGENT_KEY;
  lifecycleStatus: string;
  safeSummary: string;
  updatedAt: string;
}

export interface ChannelEvent {
  id: string;
  fingerprint: string;
  eventType: string;
  agentKey: typeof CONTROL_AGENT_KEY;
  redactedPayload: Record<string, unknown>;
  redactionCount: number;
  receivedAt: string;
}

export interface AgentOverview {
  agentState: AgentState | null;
  lastCommand: CommandRecord | null;
  events: ChannelEvent[];
}

export interface ControlDatabaseAdapter {
  findCommand(input: {
    agentKey: typeof CONTROL_AGENT_KEY;
    action: ControlAction;
    idempotencyKey: string;
  }): Promise<CommandRecord | null>;
  createCommand(input: {
    agentKey: typeof CONTROL_AGENT_KEY;
    action: ControlAction;
    idempotencyKey: string;
    promptDigest: string | null;
  }): Promise<CommandRecord>;
  completeCommand(input: {
    id: string;
    status: Exclude<CommandStatus, 'pending'>;
    errorClass: string | null;
  }): Promise<CommandRecord>;
  upsertAgentState(input: Omit<AgentState, 'agentKey' | 'updatedAt'>): Promise<AgentState>;
  insertChannelEvent(input: Omit<ChannelEvent, 'id' | 'agentKey' | 'receivedAt'>): Promise<boolean>;
  getAgentOverview(): Promise<AgentOverview>;
  deleteExpiredHistory(): Promise<void>;
}

export interface ControlRepository {
  createPendingCommand(input: {
    action: ControlAction;
    idempotencyKey: string;
    promptDigest?: string | null;
  }): Promise<CommandRecord>;
  completeCommand(
    id: string,
    status: Exclude<CommandStatus, 'pending'>,
    errorClass?: string | null,
  ): Promise<CommandRecord>;
  findCommandByIdempotencyKey(action: ControlAction, idempotencyKey: string): Promise<CommandRecord | null>;
  upsertAgentState(input: Omit<AgentState, 'agentKey' | 'updatedAt'>): Promise<AgentState>;
  insertChannelEvent(input: Omit<ChannelEvent, 'id' | 'agentKey' | 'receivedAt'>): Promise<boolean>;
  getAgentOverview(): Promise<AgentOverview>;
  deleteExpiredHistory(): Promise<void>;
}

export class ControlRepositoryError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`Control repository operation failed: ${operation}`);
    this.name = 'ControlRepositoryError';
    this.operation = operation;
  }
}

function repositoryFailure(operation: string): ControlRepositoryError {
  return new ControlRepositoryError(operation);
}

function isControlConfig(value: ControlDatabaseAdapter | ControlConfig): value is ControlConfig {
  return 'supabaseUrl' in value && 'supabaseServiceRoleKey' in value;
}

function mapCommand(row: {
  id: string;
  agent_key: string;
  action: ControlAction;
  status: CommandStatus;
  prompt_digest: string | null;
}): CommandRecord {
  return {
    id: row.id,
    agentKey: row.agent_key as typeof CONTROL_AGENT_KEY,
    action: row.action,
    status: row.status,
    promptDigest: row.prompt_digest,
  };
}

function mapState(row: {
  agent_key: string;
  lifecycle_status: string;
  safe_summary: string;
  updated_at: string;
}): AgentState {
  return {
    agentKey: row.agent_key as typeof CONTROL_AGENT_KEY,
    lifecycleStatus: row.lifecycle_status,
    safeSummary: row.safe_summary,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: {
  id: string;
  fingerprint: string;
  event_type: string;
  agent_key: string;
  redacted_payload: Record<string, unknown>;
  redaction_count: number;
  received_at: string;
}): ChannelEvent {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    eventType: row.event_type,
    agentKey: row.agent_key as typeof CONTROL_AGENT_KEY,
    redactedPayload: row.redacted_payload,
    redactionCount: row.redaction_count,
    receivedAt: row.received_at,
  };
}

function createSupabaseAdapter(config: ControlConfig): ControlDatabaseAdapter {
  const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    db: { schema: 'control' },
  });
  const commands = () => client.from('command_log');
  const states = () => client.from('agent_state');
  const events = () => client.from('channel_events');

  return {
    async findCommand(input) {
      const { data, error } = await commands()
        .select('id, agent_key, action, status, prompt_digest')
        .eq('agent_key', input.agentKey)
        .eq('action', input.action)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      if (error) throw repositoryFailure('findCommandByIdempotencyKey');
      return data ? mapCommand(data) : null;
    },
    async createCommand(input) {
      const { data, error } = await commands()
        .insert({
          agent_key: input.agentKey,
          action: input.action,
          idempotency_key: input.idempotencyKey,
          prompt_digest: input.promptDigest,
          status: 'pending',
        })
        .select('id, agent_key, action, status, prompt_digest')
        .single();
      if (error || !data) throw repositoryFailure('createPendingCommand');
      return mapCommand(data);
    },
    async completeCommand(input) {
      const { data, error } = await commands()
        .update({ status: input.status, error_class: input.errorClass, completed_at: new Date().toISOString() })
        .eq('id', input.id)
        .select('id, agent_key, action, status, prompt_digest')
        .single();
      if (error || !data) throw repositoryFailure('completeCommand');
      return mapCommand(data);
    },
    async upsertAgentState(input) {
      const { data, error } = await states()
        .upsert(
          {
            agent_key: CONTROL_AGENT_KEY,
            lifecycle_status: input.lifecycleStatus,
            safe_summary: input.safeSummary,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'agent_key' },
        )
        .select('agent_key, lifecycle_status, safe_summary, updated_at')
        .single();
      if (error || !data) throw repositoryFailure('upsertAgentState');
      return mapState(data);
    },
    async insertChannelEvent(input) {
      const { error } = await events().insert({
        fingerprint: input.fingerprint,
        event_type: input.eventType,
        agent_key: CONTROL_AGENT_KEY,
        redacted_payload: input.redactedPayload,
        redaction_count: input.redactionCount,
      });
      if (error?.code === '23505') return false;
      if (error) throw repositoryFailure('insertChannelEvent');
      return true;
    },
    async getAgentOverview() {
      const [stateResult, commandResult, eventResult] = await Promise.all([
        states().select('agent_key, lifecycle_status, safe_summary, updated_at').eq('agent_key', CONTROL_AGENT_KEY).maybeSingle(),
        commands()
          .select('id, agent_key, action, status, prompt_digest')
          .eq('agent_key', CONTROL_AGENT_KEY)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        events()
          .select('id, fingerprint, event_type, agent_key, redacted_payload, redaction_count, received_at')
          .eq('agent_key', CONTROL_AGENT_KEY)
          .order('received_at', { ascending: false })
          .limit(10),
      ]);
      if (stateResult.error || commandResult.error || eventResult.error) {
        throw repositoryFailure('getAgentOverview');
      }
      return {
        agentState: stateResult.data ? mapState(stateResult.data) : null,
        lastCommand: commandResult.data ? mapCommand(commandResult.data) : null,
        events: (eventResult.data ?? []).map(mapEvent),
      };
    },
    async deleteExpiredHistory() {
      const { error } = await client.rpc('delete_expired_history');
      if (error) throw repositoryFailure('deleteExpiredHistory');
    },
  };
}

export function createControlRepository(adapterOrConfig: ControlDatabaseAdapter | ControlConfig): ControlRepository {
  const adapter = isControlConfig(adapterOrConfig) ? createSupabaseAdapter(adapterOrConfig) : adapterOrConfig;

  return {
    createPendingCommand: async (input) => {
      try {
        return await adapter.createCommand({
          agentKey: CONTROL_AGENT_KEY,
          action: input.action,
          idempotencyKey: input.idempotencyKey,
          promptDigest: input.promptDigest ?? null,
        });
      } catch {
        throw repositoryFailure('createPendingCommand');
      }
    },
    completeCommand: async (id, status, errorClass = null) => {
      try {
        return await adapter.completeCommand({ id, status, errorClass });
      } catch {
        throw repositoryFailure('completeCommand');
      }
    },
    findCommandByIdempotencyKey: async (action, idempotencyKey) => {
      try {
        return await adapter.findCommand({ agentKey: CONTROL_AGENT_KEY, action, idempotencyKey });
      } catch {
        throw repositoryFailure('findCommandByIdempotencyKey');
      }
    },
    upsertAgentState: async (input) => {
      try {
        return await adapter.upsertAgentState(input);
      } catch {
        throw repositoryFailure('upsertAgentState');
      }
    },
    insertChannelEvent: async (input) => {
      try {
        return await adapter.insertChannelEvent(input);
      } catch {
        throw repositoryFailure('insertChannelEvent');
      }
    },
    getAgentOverview: async () => {
      try {
        return await adapter.getAgentOverview();
      } catch {
        throw repositoryFailure('getAgentOverview');
      }
    },
    deleteExpiredHistory: async () => {
      try {
        await adapter.deleteExpiredHistory();
      } catch {
        throw repositoryFailure('deleteExpiredHistory');
      }
    },
  };
}
