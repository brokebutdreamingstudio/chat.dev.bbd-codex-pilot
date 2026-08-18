import postgres from 'postgres';
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
  redactedPayload: postgres.JSONValue;
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
  return 'supabaseDbUrl' in value;
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
  redacted_payload: postgres.JSONValue;
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

function createPostgresAdapter(config: ControlConfig): ControlDatabaseAdapter {
  const sql = postgres(config.supabaseDbUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  return {
    async findCommand(input) {
      const [row] = await sql<Parameters<typeof mapCommand>[0][]>`
        select id, agent_key, action, status, prompt_digest
        from control.command_log
        where agent_key = ${input.agentKey}
          and action = ${input.action}
          and idempotency_key = ${input.idempotencyKey}
        limit 1
      `;
      return row ? mapCommand(row) : null;
    },
    async createCommand(input) {
      const [row] = await sql<Parameters<typeof mapCommand>[0][]>`
        insert into control.command_log (agent_key, action, idempotency_key, prompt_digest, status)
        values (${input.agentKey}, ${input.action}, ${input.idempotencyKey}, ${input.promptDigest}, 'pending')
        returning id, agent_key, action, status, prompt_digest
      `;
      if (!row) throw repositoryFailure('createPendingCommand');
      return mapCommand(row);
    },
    async completeCommand(input) {
      const [row] = await sql<Parameters<typeof mapCommand>[0][]>`
        update control.command_log
        set status = ${input.status}, error_class = ${input.errorClass}, completed_at = now()
        where id = ${input.id}
        returning id, agent_key, action, status, prompt_digest
      `;
      if (!row) throw repositoryFailure('completeCommand');
      return mapCommand(row);
    },
    async upsertAgentState(input) {
      const [row] = await sql<Parameters<typeof mapState>[0][]>`
        insert into control.agent_state (agent_key, lifecycle_status, safe_summary, updated_at)
        values (${CONTROL_AGENT_KEY}, ${input.lifecycleStatus}, ${input.safeSummary}, now())
        on conflict (agent_key) do update
        set lifecycle_status = excluded.lifecycle_status,
            safe_summary = excluded.safe_summary,
            updated_at = excluded.updated_at
        returning agent_key, lifecycle_status, safe_summary, updated_at
      `;
      if (!row) throw repositoryFailure('upsertAgentState');
      return mapState(row);
    },
    async insertChannelEvent(input) {
      const rows = await sql<{ id: string }[]>`
        insert into control.channel_events (fingerprint, event_type, agent_key, redacted_payload, redaction_count)
        values (
          ${input.fingerprint},
          ${input.eventType},
          ${CONTROL_AGENT_KEY},
          ${sql.json(input.redactedPayload)},
          ${input.redactionCount}
        )
        on conflict (fingerprint) do nothing
        returning id
      `;
      return rows.length === 1;
    },
    async getAgentOverview() {
      const [states, commands, events] = await Promise.all([
        sql<Parameters<typeof mapState>[0][]>`
          select agent_key, lifecycle_status, safe_summary, updated_at
          from control.agent_state
          where agent_key = ${CONTROL_AGENT_KEY}
          limit 1
        `,
        sql<Parameters<typeof mapCommand>[0][]>`
          select id, agent_key, action, status, prompt_digest
          from control.command_log
          where agent_key = ${CONTROL_AGENT_KEY}
          order by created_at desc
          limit 1
        `,
        sql<Parameters<typeof mapEvent>[0][]>`
          select id, fingerprint, event_type, agent_key, redacted_payload, redaction_count, received_at
          from control.channel_events
          where agent_key = ${CONTROL_AGENT_KEY}
          order by received_at desc
          limit 10
        `,
      ]);
      return {
        agentState: states[0] ? mapState(states[0]) : null,
        lastCommand: commands[0] ? mapCommand(commands[0]) : null,
        events: events.map(mapEvent),
      };
    },
    async deleteExpiredHistory() {
      await sql`select control.delete_expired_history()`;
    },
  };
}

export function createControlRepository(adapterOrConfig: ControlDatabaseAdapter | ControlConfig): ControlRepository {
  const adapter = isControlConfig(adapterOrConfig) ? createPostgresAdapter(adapterOrConfig) : adapterOrConfig;

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
