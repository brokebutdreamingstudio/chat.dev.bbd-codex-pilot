# Control-plane operator runbook

Founder-only. Do not paste secret values, login URLs, headers, or callback
payloads into Git, chat, issues, tickets, shell history, or this document.

1. Create Vercel project `folio-concierge-control` from the pilot repository; do not deploy the future Telegram project with the same environment values.
2. Add the eight secret variables from the design spec in Vercel with values entered manually: `CHATDEV_CHANNEL_ID`, `CHATDEV_CHANNEL_API_KEY`, `CHATDEV_CHANNEL_WEBHOOK_SECRET`, `CHATDEV_CONTROL_EXTERNAL_USER_ID`, `CHATDEV_CONTROL_DISPLAY_NAME`, `CHATDEV_AGENT_NAME`, pooled direct-Postgres `SUPABASE_DB_URL`, and `CONTROL_API_TOKEN`. Set no `NEXT_PUBLIC_*` secret. `SUPABASE_DB_URL` is a pooled direct PostgreSQL connection URL for the private control schema, not a Supabase service-role key.
3. Apply `supabase/migrations/202608170001_chatdev_control.sql` to the existing Folio Supabase project through the approved migration workflow.
4. Create a Channel in chat.dev with `https://<control-deployment>/api/chatdev/callback` as callback URL.
5. Complete the Channel identity `/login` binding in the founder's browser without copying its resulting URL into a chat, ticket, shell history, or database.
6. Add `CONTROL_API_TOKEN` to the local Keychain under service `bbd.chatdev-control` and set local `CHATDEV_CONTROL_URL`.
7. Run the smoke sequence in Task 7.

## Local operator client

`chatdevctl` reads the control token only from the macOS Keychain service
`bbd.chatdev-control`. It accepts no credentials as arguments or environment
variables, communicates only with `CHATDEV_CONTROL_URL`, and supports only the
allowlisted commands below. `CHATDEV_CONTROL_URL` must be HTTPS, apart from
`http://localhost` in local tests.

```bash
node scripts/chatdevctl.mjs status
node scripts/chatdevctl.mjs start
node scripts/chatdevctl.mjs stop
node scripts/chatdevctl.mjs restart
printf '%s' 'safe instruction' | node scripts/chatdevctl.mjs prompt
```

Do not put the prompt on the command line. Each invocation creates a new local
idempotency UUID. The client redacts credential-like API output before printing
it; treat all output as operational metadata, not as a place to recover a
secret.

## Task 7 smoke sequence

After the founder has explicitly approved each external action, run, in order:

```bash
node scripts/chatdevctl.mjs status
node scripts/chatdevctl.mjs start
printf '%s' 'Return exactly: control-plane smoke acknowledged.' | node scripts/chatdevctl.mjs prompt
node scripts/chatdevctl.mjs stop
```

Record only sanitized timestamps, command IDs, HTTP status classes, and
redaction counts in the Task 7 smoke record. Do not run a direct chat.dev,
Vercel, or Supabase control operation from the local client.
