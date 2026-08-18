import { z } from 'zod';
import {
  CONTROL_AGENT_KEY,
  type AgentBinding,
  type ControlConfig,
} from './types';

const environmentSchema = z
  .object({
    CONTROL_API_TOKEN: z.string().min(1),
    CHATDEV_CHANNEL_ID: z.string().min(1),
    CHATDEV_CHANNEL_API_KEY: z.string().min(1),
    CHATDEV_CHANNEL_WEBHOOK_SECRET: z.string().min(1),
    CHATDEV_CONTROL_EXTERNAL_USER_ID: z.string().min(1),
    CHATDEV_CONTROL_DISPLAY_NAME: z.string().min(1),
    CHATDEV_AGENT_NAME: z.literal(CONTROL_AGENT_KEY),
    SUPABASE_DB_URL: z.string().url(),
  })
  .strict();

export function parseControlConfig(env: Record<string, unknown>): ControlConfig {
  const parsed = environmentSchema.parse({
    CONTROL_API_TOKEN: env.CONTROL_API_TOKEN,
    CHATDEV_CHANNEL_ID: env.CHATDEV_CHANNEL_ID,
    CHATDEV_CHANNEL_API_KEY: env.CHATDEV_CHANNEL_API_KEY,
    CHATDEV_CHANNEL_WEBHOOK_SECRET: env.CHATDEV_CHANNEL_WEBHOOK_SECRET,
    CHATDEV_CONTROL_EXTERNAL_USER_ID: env.CHATDEV_CONTROL_EXTERNAL_USER_ID,
    CHATDEV_CONTROL_DISPLAY_NAME: env.CHATDEV_CONTROL_DISPLAY_NAME,
    CHATDEV_AGENT_NAME: env.CHATDEV_AGENT_NAME,
    SUPABASE_DB_URL: env.SUPABASE_DB_URL,
  });
  const agent: AgentBinding = {
    key: CONTROL_AGENT_KEY,
    name: parsed.CHATDEV_AGENT_NAME,
    externalUserId: parsed.CHATDEV_CONTROL_EXTERNAL_USER_ID,
    displayName: parsed.CHATDEV_CONTROL_DISPLAY_NAME,
  };

  return {
    controlToken: parsed.CONTROL_API_TOKEN,
    channelId: parsed.CHATDEV_CHANNEL_ID,
    channelApiKey: parsed.CHATDEV_CHANNEL_API_KEY,
    webhookSecret: parsed.CHATDEV_CHANNEL_WEBHOOK_SECRET,
    supabaseDbUrl: parsed.SUPABASE_DB_URL,
    agent,
  };
}
