import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('control history retention schedule', () => {
  it('configures one named daily pg_cron job that invokes the 30-day cleanup', async () => {
    const migration = await readFile(join(
      import.meta.dirname,
      '..',
      '..',
      'supabase',
      'migrations',
      '202608170001_chatdev_control.sql',
    ), 'utf8');
    const schedule = migration.match(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\$\$(.*?)\$\$\s*\)/s);

    expect(schedule?.[1]).toBe('control-delete-expired-history-daily');
    expect(schedule?.[2]).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(schedule?.[3]?.trim()).toBe('select control.delete_expired_history();');
  });
});
