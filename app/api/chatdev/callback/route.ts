import { parseControlConfig } from '../../../../src/lib/control/config';
import { jsonError } from '../../../../src/lib/control/http';
import { createControlRepository, type ControlRepository } from '../../../../src/lib/control/repository';
import { fingerprint, redactText, verifyWebhookSignature } from '../../../../src/lib/control/security';
import type { ControlConfig } from '../../../../src/lib/control/types';

const MAX_CALLBACK_BYTES = 128 * 1024;

interface CallbackPayload {
  event: string;
  channelId: string;
  externalUserId: string;
  message: string;
  groupExternalId?: string;
}

function isCallbackPayload(value: unknown): value is CallbackPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.event === 'string' && typeof payload.channelId === 'string'
    && typeof payload.externalUserId === 'string' && typeof payload.message === 'string'
    && (payload.groupExternalId === undefined || typeof payload.groupExternalId === 'string');
}

export function createCallbackPost(config: ControlConfig, repository: ControlRepository) {
  return async function POST(request: Request): Promise<Response> {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_CALLBACK_BYTES) return jsonError(413, 'payload_too_large');
    if (!verifyWebhookSignature(rawBody, request.headers.get('x-webhook-signature'), config.webhookSecret)) {
      return jsonError(401, 'unauthorized');
    }

    let value: unknown;
    try {
      value = JSON.parse(rawBody);
    } catch {
      return jsonError(400, 'invalid_request');
    }
    if (!isCallbackPayload(value)
      || value.channelId !== config.channelId
      || value.externalUserId !== config.agent.externalUserId) {
      return jsonError(401, 'unauthorized');
    }

    const redacted = redactText(value.message);
    const redactedPayload = {
      event: value.event,
      agentKey: config.agent.key,
      message: redacted.text,
      ...(value.groupExternalId === undefined ? {} : { groupExternalId: value.groupExternalId }),
    };
    try {
      const inserted = await repository.insertChannelEvent({
        fingerprint: fingerprint(rawBody), eventType: value.event, redactedPayload, redactionCount: redacted.redactionCount,
      });
      if (inserted) await repository.upsertAgentState({ lifecycleStatus: value.event, safeSummary: redacted.text });
      return new Response(null, { status: 204 });
    } catch {
      return jsonError(500, 'dispatch_failed');
    }
  };
}

export async function POST(request: Request): Promise<Response> {
  const config = parseControlConfig(process.env);
  return createCallbackPost(config, createControlRepository(config))(request);
}
