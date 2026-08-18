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
  return typeof payload.event === 'string' && payload.event.length > 0 && payload.event.length <= 128
    && typeof payload.channelId === 'string'
    && typeof payload.externalUserId === 'string' && typeof payload.message === 'string'
    && (payload.groupExternalId === undefined
      || (typeof payload.groupExternalId === 'string'
        && payload.groupExternalId.length > 0
        && payload.groupExternalId.length <= 256));
}

async function readBoundedBody(request: Request): Promise<
  { ok: true; rawBody: string } | { ok: false; tooLarge: boolean }
> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, tooLarge: false };
    if (Number(contentLength) > MAX_CALLBACK_BYTES) return { ok: false, tooLarge: true };
  }

  if (request.body === null) return { ok: true, rawBody: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CALLBACK_BYTES) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }

  return { ok: true, rawBody: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes).toString('utf8') };
}

export function createCallbackPost(config: ControlConfig, repository: ControlRepository) {
  return async function POST(request: Request): Promise<Response> {
    const body = await readBoundedBody(request);
    if (!body.ok) return jsonError(body.tooLarge ? 413 : 400, body.tooLarge ? 'payload_too_large' : 'invalid_request');
    const rawBody = body.rawBody;
    if (!verifyWebhookSignature(rawBody, request.headers.get('x-webhook-signature'), config.webhookSecret)) {
      return jsonError(401, 'unauthorized');
    }

    let value: unknown;
    try {
      value = JSON.parse(rawBody);
    } catch {
      return jsonError(400, 'invalid_request');
    }
    if (!isCallbackPayload(value)) return jsonError(400, 'invalid_request');
    if (value.channelId !== config.channelId || value.externalUserId !== config.agent.externalUserId) {
      return jsonError(401, 'unauthorized');
    }

    const redactedEvent = redactText(value.event);
    const redactedMessage = redactText(value.message);
    const redactedGroup = value.groupExternalId === undefined ? undefined : redactText(value.groupExternalId);
    const redactedPayload = {
      event: redactedEvent.text,
      agentKey: config.agent.key,
      message: redactedMessage.text,
      ...(redactedGroup === undefined ? {} : { groupExternalId: redactedGroup.text }),
    };
    try {
      await repository.recordChannelEvent({
        event: {
          fingerprint: fingerprint(rawBody),
          eventType: redactedEvent.text,
          redactedPayload,
          redactionCount: redactedEvent.redactionCount + redactedMessage.redactionCount
            + (redactedGroup?.redactionCount ?? 0),
        },
        state: { lifecycleStatus: redactedEvent.text, safeSummary: redactedMessage.text },
      });
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
