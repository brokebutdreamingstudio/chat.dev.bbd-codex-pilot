import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'scripts', 'chatdevctl.mjs');
const keychainValue = 'keychain-test-value';

interface CliResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

async function runCli(args: string[], env: Record<string, string>, stdin = ''): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ stdout, stderr, status }));
    child.stdin.end(stdin);
  });
}

async function fakeSecurity(): Promise<{ path: string; invocation: () => Promise<string>; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'chatdevctl-test-'));
  const log = join(directory, 'security-invocation');
  const binary = join(directory, 'security');
  await writeFile(binary, `#!/bin/sh\nprintf '%s\\n' \"$@\" > '${log}'\nprintf '%s' '${keychainValue}'\n`);
  await chmod(binary, 0o755);
  return {
    path: directory,
    invocation: () => readFile(log, 'utf8'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function controlServer(body: unknown, status = 200): Promise<{
  url: string;
  request: Promise<{ url: string; headers: Record<string, string | string[] | undefined>; body: string }>;
  close: () => Promise<void>;
}> {
  let resolveRequest!: (value: { url: string; headers: Record<string, string | string[] | undefined>; body: string }) => void;
  const request = new Promise<{ url: string; headers: Record<string, string | string[] | undefined>; body: string }>((resolve) => {
    resolveRequest = resolve;
  });
  const server = createServer((incoming, outgoing) => {
    let received = '';
    incoming.on('data', (chunk) => { received += chunk; });
    incoming.on('end', () => {
      resolveRequest({ url: incoming.url ?? '', headers: incoming.headers, body: received });
      outgoing.writeHead(status, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return {
    url: `http://localhost:${address.port}`,
    request,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

describe('chatdevctl', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

  it('does not accept a token argument and reads the Keychain service name', async () => {
    const keychain = await fakeSecurity();
    cleanups.push(keychain.cleanup);
    const server = await controlServer({ ok: true });
    cleanups.push(server.close);

    const result = await runCli(['status'], {
      PATH: `${keychain.path}:${process.env.PATH}`,
      CHATDEV_CONTROL_URL: server.url,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain(keychainValue);
    expect(await keychain.invocation()).toBe('find-generic-password\n-w\n-s\nbbd.chatdev-control\n');
  });

  it('reads a prompt from standard input and sends it only to the Control API', async () => {
    const keychain = await fakeSecurity();
    cleanups.push(keychain.cleanup);
    const server = await controlServer({ accepted: true });
    cleanups.push(server.close);

    const result = await runCli(['prompt'], {
      PATH: `${keychain.path}:${process.env.PATH}`,
      CHATDEV_CONTROL_URL: server.url,
    }, 'safe instruction');
    const request = await server.request;

    expect(result.status).toBe(0);
    expect(request.url).toBe('/api/control/agents/bbd-folio-concierge/prompt');
    expect(request.headers.authorization).toBe(`Bearer ${keychainValue}`);
    expect(JSON.parse(request.body)).toEqual({ prompt: 'safe instruction' });
    expect(request.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.stdout).not.toContain(keychainValue);
  });

  it('redacts credential-like API output, including on an error response', async () => {
    const keychain = await fakeSecurity();
    cleanups.push(keychain.cleanup);
    const server = await controlServer({ error: `Bearer ${keychainValue}`, detail: 'ssh -i /private/key user@host' }, 502);
    cleanups.push(server.close);

    const result = await runCli(['status'], {
      PATH: `${keychain.path}:${process.env.PATH}`,
      CHATDEV_CONTROL_URL: server.url,
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain(keychainValue);
    expect(result.stdout + result.stderr).not.toContain('/private/key');
    expect(result.stdout + result.stderr).toContain('[REDACTED]');
  });

  it('uses the service redactor for GitHub token families and legacy Supabase JWTs', async () => {
    const keychain = await fakeSecurity();
    cleanups.push(keychain.cleanup);
    const githubToken = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const serviceRoleJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCJ9.c2lnbmF0dXJl';
    const server = await controlServer({ githubToken, serviceRoleJwt });
    cleanups.push(server.close);

    const result = await runCli(['status'], {
      PATH: `${keychain.path}:${process.env.PATH}`,
      CHATDEV_CONTROL_URL: server.url,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(githubToken);
    expect(result.stdout).not.toContain(serviceRoleJwt);
    expect(result.stdout.match(/\[REDACTED\]/g)).toHaveLength(2);
  });

  it('rejects an empty prompt and non-local insecure URLs before sending a request', async () => {
    const keychain = await fakeSecurity();
    cleanups.push(keychain.cleanup);

    const empty = await runCli(['prompt'], {
      PATH: `${keychain.path}:${process.env.PATH}`,
      CHATDEV_CONTROL_URL: 'https://control.example.test',
    });
    const insecure = await runCli(['status'], {
      PATH: `${keychain.path}:${process.env.PATH}`,
      CHATDEV_CONTROL_URL: 'http://control.example.test',
    });

    expect(empty.status).not.toBe(0);
    expect(insecure.status).not.toBe(0);
  });
});
