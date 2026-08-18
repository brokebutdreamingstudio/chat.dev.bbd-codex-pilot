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

  it.each([
    'gho_abcdefghijklmnopqrstuvwxyz0123456789',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'ghu_abcdefghijklmnopqrstuvwxyz0123456789',
    'ghs_abcdefghijklmnopqrstuvwxyz0123456789',
    'ghr_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_abcdefghijklmnopqrstuvwxyz0123456789',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoidGVzdCJ9.c2lnbmF0dXJl',
  ])('redacts and rejects supported credential family %s', (credential) => {
    expect(redactText(`before ${credential} after`)).toEqual({
      text: 'before [REDACTED] after',
      redactionCount: 1,
    });
    expect(() => assertSafePrompt(`use ${credential}`)).toThrow();
  });

  it.each([
    'postgres://test-user:test-password@db.example.test:5432/postgres',
    'postgresql://test-user:test-password@db.example.test:5432/postgres',
  ])('redacts and rejects Postgres credential URL %s', (credential) => {
    expect(redactText(`database=${credential}`)).toEqual({
      text: 'database=[REDACTED]',
      redactionCount: 1,
    });
    expect(() => assertSafePrompt(`inspect ${credential}`)).toThrow();
  });

  it('bounds prompts by UTF-8 byte count', () => {
    expect(() => assertSafePrompt('a'.repeat(4096))).not.toThrow();
    expect(() => assertSafePrompt('a'.repeat(4097))).toThrow();
    expect(() => assertSafePrompt('🙂'.repeat(1024))).not.toThrow();
    expect(() => assertSafePrompt('🙂'.repeat(1025))).toThrow();
    expect(() => assertSafePrompt(null)).toThrow();
  });

  it('redacts a complete ssh command through its line boundary', () => {
    const redacted = redactText('ssh -i /path/to/private-key user@host -p 22\nkeep this line');
    expect(redacted.text).toBe('[REDACTED]\nkeep this line');
    expect(redacted.redactionCount).toBe(1);
  });
});
