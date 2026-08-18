### Task 6 report — local operator client and runbook

Status: complete

Implemented `scripts/chatdevctl.mjs` with a fixed five-command allowlist. It
retrieves the control token only through macOS Keychain service
`bbd.chatdev-control`, accepts prompts only from standard input, creates one
UUID idempotency key per command, calls only `CHATDEV_CONTROL_URL`, and redacts
credential-like response output before printing it.

Added `tests/control/chatdevctl.test.ts`, using a spawned Node process and fake
`security` binary. Coverage proves the Keychain invocation, stdin prompt body,
Control API authorization/path, generated idempotency key, empty-prompt and
insecure-URL rejection, and redaction on a non-success API response.

Added founder-only `docs/control-plane-operator-runbook.md` with the exact
seven provisioning actions. It specifies pooled direct-Postgres
`SUPABASE_DB_URL`, not a Supabase service-role key, and prohibits
`NEXT_PUBLIC_*` secrets. README links the runbook and states the secret-input
prohibitions.

Verification run:

```text
npm run lint                 PASS
npm run typecheck            PASS
npm test -- --run            PASS (9 files, 39 tests)
```

Known non-blocking harness warning: Vitest/Vite reports the pre-existing native
config-loader ESM warning; all checks exit successfully.
