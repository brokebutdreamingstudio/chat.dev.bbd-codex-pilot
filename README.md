# Folio Concierge

Telegram-first MVP service for the Folio concierge.

## Local development

```bash
npm install
npm run dev
```

The health endpoint is available at `GET /api/health` and returns only:

```json
{ "status": "ok" }
```

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Founder-only operations

Deployment, Vercel and Supabase provisioning, all secret entry, Telegram bot
configuration, and real Telegram webhook registration are founder actions.
`.env.example` lists variable names only; do not commit secret values, real user
data, or production logs.

The [control-plane operator runbook](docs/control-plane-operator-runbook.md)
defines the founder-only control deployment and smoke sequence. No secret is
accepted in GitHub issues, PRs, `.env.example`, CLI arguments, or test fixtures.
