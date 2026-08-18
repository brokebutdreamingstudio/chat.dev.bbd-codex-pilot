create schema if not exists control;

revoke all on schema control from public, anon, authenticated;

create table control.agent_state (
  agent_key text primary key check (agent_key = 'bbd-folio-concierge'),
  lifecycle_status text not null,
  safe_summary text not null default '',
  updated_at timestamptz not null default now()
);

create table control.command_log (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null references control.agent_state(agent_key),
  action text not null check (action in ('status', 'start', 'stop', 'restart', 'prompt')),
  idempotency_key text not null,
  prompt_digest text,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  error_class text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (agent_key, action, idempotency_key)
);

create table control.channel_events (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  event_type text not null,
  agent_key text not null references control.agent_state(agent_key),
  redacted_payload jsonb not null,
  redaction_count integer not null default 0,
  received_at timestamptz not null default now()
);

alter table control.agent_state enable row level security;
alter table control.command_log enable row level security;
alter table control.channel_events enable row level security;

revoke all on table control.agent_state from public, anon, authenticated;
revoke all on table control.command_log from public, anon, authenticated;
revoke all on table control.channel_events from public, anon, authenticated;

insert into control.agent_state (agent_key, lifecycle_status)
values ('bbd-folio-concierge', 'unknown')
on conflict (agent_key) do nothing;

create function control.delete_expired_history()
returns void
language plpgsql
security definer
set search_path = control, pg_temp
as $$
begin
  delete from control.command_log
  where created_at < now() - interval '30 days';

  delete from control.channel_events
  where received_at < now() - interval '30 days';
end;
$$;

revoke all on function control.delete_expired_history() from public, anon, authenticated;
