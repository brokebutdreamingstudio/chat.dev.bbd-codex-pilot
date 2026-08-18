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
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  })
  .strict();

export function parseControlConfig(env: Record<string, unknown>): ControlConfig {
  const parsed = environmentSchema.parse(env);
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
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    agent,
  };
}
