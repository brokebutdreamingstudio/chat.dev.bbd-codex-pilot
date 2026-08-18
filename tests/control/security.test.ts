import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertSafePrompt,
  redactText,
  verifyBearer,
  verifyWebhookSignature,
} from '../../src/lib/control/security';

describe('control security', () => {
  it('accepts only an exact bearer token', () => {
    expect(verifyBearer('Bearer control-token', 'control-token')).toBe(true);
    expect(verifyBearer('Bearer wrong-token', 'control-token')).toBe(false);
    expect(verifyBearer(null, 'control-token')).toBe(false);
    expect(verifyBearer('Bearer control-token-extra', 'control-token')).toBe(false);
  });

  it('verifies a raw-body HMAC before parsing', () => {
    const body = '{"event":"message.send"}';
    const signature = createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifyWebhookSignature(body, signature, 'secret')).toBe(true);
    expect(verifyWebhookSignature(body, 'not-a-signature', 'secret')).toBe(false);
    expect(verifyWebhookSignature(body, null, 'secret')).toBe(false);
  });

  it('redacts secrets and rejects secret-shaped prompts', () => {
    const redacted = redactText('Bearer abcdefghijklmnopqrstuvwxyz and github_pat_abcdefghijklmnopqrstuv');
    expect(redacted.text).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(redacted.redactionCount).toBe(2);
    expect(() => assertSafePrompt('github_pat_abcdefghijklmnopqrstuv')).toThrow();
  });

  it('bounds prompts by UTF-8 character count', () => {
    expect(() => assertSafePrompt('a'.repeat(4096))).not.toThrow();
    expect(() => assertSafePrompt('a'.repeat(4097))).toThrow();
    expect(() => assertSafePrompt(null)).toThrow();
  });
});
