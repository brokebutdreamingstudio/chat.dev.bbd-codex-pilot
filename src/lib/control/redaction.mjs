// This module is plain ESM so both the TypeScript service and the dependency-free
// Node CLI execute exactly the same credential matching code.
const CREDENTIAL_PATTERN =
  /Bearer\s+[^\s"'`<>]+|github_pat_[A-Za-z0-9_]+|gh[opusr]_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk_[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|postgres:\/\/[^\s"'`<>]+|session-login\?sid=[^\s"'`<>]+|ssh:\/\/[^\s"'`<>]+|ssh\s+-[^\r\n]*/gi;

/**
 * @param {string} value
 * @returns {{ text: string, redactionCount: number }}
 */
export function redactCredentials(value) {
  let redactionCount = 0;
  const text = value.replace(CREDENTIAL_PATTERN, () => {
    redactionCount += 1;
    return '[REDACTED]';
  });
  CREDENTIAL_PATTERN.lastIndex = 0;
  return { text, redactionCount };
}

/** @param {string} value */
export function containsCredential(value) {
  const found = CREDENTIAL_PATTERN.test(value);
  CREDENTIAL_PATTERN.lastIndex = 0;
  return found;
}
