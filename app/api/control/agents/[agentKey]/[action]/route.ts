import { createChatDevChannelClient } from '../../../../../../src/lib/control/channel-api';
import { parseControlConfig } from '../../../../../../src/lib/control/config';
import { jsonError, requireControlBearer, requireIdempotencyKey } from '../../../../../../src/lib/control/http';
import { createControlRepository } from '../../../../../../src/lib/control/repository';
import { ControlCommandError, createControlService, type ControlService } from '../../../../../../src/lib/control/service';
import { CONTROL_ACTIONS, CONTROL_AGENT_KEY, type ControlConfig } from '../../../../../../src/lib/control/types';

type ActionContext = { params: Promise<{ agentKey: string; action: string }> };

function isAction(value: string): value is (typeof CONTROL_ACTIONS)[number] {
  return CONTROL_ACTIONS.includes(value as (typeof CONTROL_ACTIONS)[number]);
}

async function promptBody(request: Request): Promise<{ prompt: unknown } | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('prompt' in body)) return null;
    return body as { prompt: unknown };
  } catch {
    return null;
  }
}

export function createAgentActionPost(config: ControlConfig, service: ControlService) {
  return async function POST(request: Request, context: ActionContext): Promise<Response> {
    if (!requireControlBearer(request, config)) return jsonError(401, 'unauthorized');
    const { agentKey, action } = await context.params;
    if (agentKey !== CONTROL_AGENT_KEY || !isAction(action)) return jsonError(404, 'not_found');
    const idempotencyKey = requireIdempotencyKey(request);
    if (!idempotencyKey) return jsonError(400, 'invalid_request');

    let prompt: unknown;
    if (action === 'prompt') {
      const body = await promptBody(request);
      if (!body) return jsonError(400, 'invalid_request');
      prompt = body.prompt;
    } else if ((await request.text()).length > 0) {
      return jsonError(400, 'invalid_request');
    }

    try {
      const command = await service.execute({ agentKey, action, idempotencyKey, prompt });
      return Response.json({ id: command.id, action: command.action, status: command.status });
    } catch (error) {
      if (error instanceof ControlCommandError) return jsonError(502, 'dispatch_failed');
      return jsonError(400, 'invalid_request');
    }
  };
}

export async function POST(request: Request, context: ActionContext): Promise<Response> {
  const config = parseControlConfig(process.env);
  const repository = createControlRepository(config);
  const service = createControlService(config, repository, createChatDevChannelClient(config));
  return createAgentActionPost(config, service)(request, context);
}
