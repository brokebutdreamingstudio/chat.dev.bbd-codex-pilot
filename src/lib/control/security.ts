import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_PROMPT_BYTES = 4_096;

// Keep these deliberately conservative: values crossing the control-plane
// boundary are untrusted, so false positives are preferable to persistence.
const SECRET_PATTERN =
  /Bearer\s+[^\s"'`<>]+|gho_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+|sk_[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|postgres:\/\/[^\s"'`<>]+|session-login\?sid=[^\s"'`<>]+/gi;

const REDACTION_PATTERN =
  /Bearer\s+[^\s"'`<>]+|gho_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+|sk_[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|postgres:\/\/[^\s"'`<>]+|session-login\?sid=[^\s"'`<>]+|ssh:\/\/[^\s"'`<>]+|ssh\s+-[^\r\n]*/gi;

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyBearer(header: string | null, expected: string): boolean {
  if (header === null || !header.startsWith('Bearer ') || expected.length === 0) {
    return false;
  }

  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const configured = Buffer.from(expected, 'utf8');
  return constantTimeEqual(supplied, configured);
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (signature === null || secret.length === 0 || !/^[a-f0-9]+$/i.test(signature)) {
    return false;
  }

  const supplied = Buffer.from(signature, 'hex');
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  return constantTimeEqual(supplied, expected);
}

export function assertSafePrompt(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_PROMPT_BYTES) {
    throw new Error('Prompt must be a string of at most 4096 characters');
  }

  if (SECRET_PATTERN.test(value)) {
    SECRET_PATTERN.lastIndex = 0;
    throw new Error('Prompt contains a credential-like value');
  }
  SECRET_PATTERN.lastIndex = 0;
}

export function redactText(value: string): { text: string; redactionCount: number } {
  let redactionCount = 0;
  const text = value.replace(REDACTION_PATTERN, () => {
    redactionCount += 1;
    return '[REDACTED]';
  });
  REDACTION_PATTERN.lastIndex = 0;
  return { text, redactionCount };
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
