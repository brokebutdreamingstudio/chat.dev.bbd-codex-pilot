#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { redactCredentials } from '../src/lib/control/redaction.mjs';

const executeFile = promisify(execFile);
const ACTIONS = new Set(['status', 'start', 'stop', 'restart', 'prompt']);
const AGENT_KEY = 'bbd-folio-concierge';

function usage() {
  return 'Usage: chatdevctl <status|start|stop|restart|prompt>';
}

function controlUrl(value) {
  if (!value) throw new Error('CHATDEV_CONTROL_URL is required');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('CHATDEV_CONTROL_URL must be an HTTPS URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new Error('CHATDEV_CONTROL_URL must be an HTTPS URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('CHATDEV_CONTROL_URL must not contain credentials, a query, or a fragment');
  }
  return url;
}

async function readToken() {
  try {
    const { stdout } = await executeFile('security', ['find-generic-password', '-w', '-s', 'bbd.chatdev-control']);
    const token = stdout.trim();
    if (!token) throw new Error('empty keychain item');
    return token;
  } catch {
    throw new Error('CONTROL_API_TOKEN was not available from the macOS Keychain');
  }
}

function redact(value) {
  return redactCredentials(value).text;
}

async function readStandardInput() {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

async function main() {
  const [action, ...arguments_] = process.argv.slice(2);
  if (!action || !ACTIONS.has(action) || arguments_.length > 0) throw new Error(usage());

  const baseUrl = controlUrl(process.env.CHATDEV_CONTROL_URL);
  const prompt = action === 'prompt' ? await readStandardInput() : undefined;
  if (action === 'prompt' && !prompt?.trim()) throw new Error('Prompt must be supplied on standard input');

  const token = await readToken();
  const endpoint = new URL(`/api/control/agents/${AGENT_KEY}/${action}`, baseUrl);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': randomUUID(),
        ...(action === 'prompt' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(action === 'prompt' ? { body: JSON.stringify({ prompt }) } : {}),
    });
  } catch {
    throw new Error('Control API request failed');
  }

  const output = redact(await response.text());
  if (output) process.stdout.write(`${output}\n`);
  if (!response.ok) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    process.stderr.write(`${redact(error instanceof Error ? error.message : 'chatdevctl failed')}\n`);
    process.exit(1);
  },
);
