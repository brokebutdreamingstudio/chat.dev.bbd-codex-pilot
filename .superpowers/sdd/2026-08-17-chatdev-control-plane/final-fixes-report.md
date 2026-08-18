# Final review fixes report

**Date:** 2026-08-17

**Scope:** All findings in `final-review.md`

**External actions:** None. No Vercel deployment, Supabase migration, chat.dev call, secret retrieval, push, or real-service access was performed.

## Result by finding

### Critical — production environment parsing

- `parseControlConfig` now constructs an object containing only the eight control-plane keys before applying the strict schema.
- A regression test passes realistic unrelated `PATH`, `NODE_ENV`, and Vercel keys while retaining fail-closed validation for the required keys.

### High — complete shared credential redaction

- Added one plain-ESM redaction module executed by both the TypeScript service boundary and `chatdevctl`.
- Prompt rejection, callback redaction, API-output redaction, and CLI error redaction now share the same patterns.
- Covered `gho_`, `ghp_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, JWT-shaped legacy Supabase keys, Bearer values, `sk_`, `sb_secret_`, Postgres URLs, session-login URLs, and SSH forms.

### High — atomic callback event and state projection

- Replaced separate `insertChannelEvent` and `upsertAgentState` writes with `recordChannelEvent`.
- The production adapter emits one data-modifying CTE statement: state projection selects only from a newly inserted fingerprint row.
- Duplicate fingerprints therefore do not reproject state, and any projection failure rolls the event insert back with the statement so a retry can insert and project safely.

### Medium — retained callback metadata

- `event` and `groupExternalId` now have non-empty maximum lengths (128 and 256 characters).
- Both are redacted before entering `event_type`, `redacted_payload`, or current state; their replacements contribute to `redaction_count`.
- Invalid metadata is rejected before the repository boundary.

### Medium — Postgres pooling

- Repository construction now reuses one module-scoped `postgres` client instead of creating a pool per route composition/request.
- A regression test composes three repositories and observes one client construction.

### Medium — scheduled 30-day retention

- The migration enables `pg_cron` and configures the named daily job `control-delete-expired-history-daily` at `17 3 * * *`.
- The job calls `control.delete_expired_history()`, which deletes only 30-day command/event history and retains current agent state.
- The operator runbook documents the schedule and the read-only `cron.job` verification query.
- This change only configures the migration; it was not applied to Supabase.

### Medium — bounded callback body

- Oversized numeric `Content-Length` is rejected with `413` before the body is accessed.
- Bodies without a trustworthy length are read from the stream with a running byte count; the reader is cancelled immediately after crossing 128 KiB.
- `request.text()` is no longer used, so unauthenticated bodies are never fully buffered before enforcement.

### Low — Vitest ESM configuration

- Renamed `vitest.config.ts` to `vitest.config.mts`.
- The final full test run emits no native-config/CommonJS warning.

## TDD evidence

### Cycle 1 — config and shared redaction

RED:

```text
npm test -- --run tests/control/config.test.ts tests/control/security.test.ts tests/control/chatdevctl.test.ts
Test Files 3 failed (3)
Tests 7 failed | 13 passed (20)
```

Expected failures witnessed: strict parsing rejected unrelated environment keys; `ghp_`, `ghu_`, `ghs_`, `ghr_`, and JWT fixtures were not redacted/rejected; CLI printed the same missing families.

GREEN:

```text
npm test -- --run tests/control/config.test.ts tests/control/security.test.ts tests/control/chatdevctl.test.ts
Test Files 3 passed (3)
Tests 20 passed (20)
```

### Cycle 2 — callback atomicity, metadata, and bounded streaming

RED:

```text
npm test -- --run tests/control/callback.test.ts
Test Files 1 failed (1)
Tests 7 failed | 3 passed (10)
```

Expected failures witnessed: the atomic repository operation was never called; duplicates still projected state; projection retry used the split writes; metadata remained unsanitized/unbounded; both early-length and stream tests reached `request.text()`.

GREEN:

```text
npm test -- --run tests/control/callback.test.ts
Test Files 1 passed (1)
Tests 10 passed (10)
```

### Cycle 3 — module pool and retention schedule

RED:

```text
npm test -- --run tests/control/repository-pool.test.ts tests/control/retention.test.ts
Test Files 2 failed (2)
Tests 2 failed (2)
```

Expected failures witnessed: three repository compositions created three Postgres clients; no named cron schedule existed.

GREEN:

```text
npm test -- --run tests/control/repository-pool.test.ts tests/control/retention.test.ts
Test Files 2 passed (2)
Tests 2 passed (2)
```

## Final local verification

```text
npm run lint
PASS

npm run typecheck
PASS

npm test -- --run
Test Files 11 passed (11)
Tests 54 passed (54)
No Vitest ESM/CommonJS warning.

npm run build
PASS
Callback and both control routes emitted as dynamic routes.

git diff --check
PASS
```

Secret review found only synthetic test fixtures and pattern literals in the changed files; no real credential value was added.
