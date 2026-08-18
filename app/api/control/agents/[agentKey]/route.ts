import { createControlRepository, type ControlRepository } from '../../../../../src/lib/control/repository';
import { parseControlConfig } from '../../../../../src/lib/control/config';
import { jsonError, requireControlBearer } from '../../../../../src/lib/control/http';
import { CONTROL_AGENT_KEY, type ControlConfig } from '../../../../../src/lib/control/types';

type AgentContext = { params: Promise<{ agentKey: string }> };

export function createAgentGet(config: ControlConfig, repository: ControlRepository) {
  return async function GET(request: Request, context: AgentContext): Promise<Response> {
    if (!requireControlBearer(request, config)) return jsonError(401, 'unauthorized');
    const { agentKey } = await context.params;
    if (agentKey !== CONTROL_AGENT_KEY) return jsonError(404, 'not_found');
    try {
      return Response.json(await repository.getAgentOverview());
    } catch {
      return jsonError(500, 'dispatch_failed');
    }
  };
}

export async function GET(request: Request, context: AgentContext): Promise<Response> {
  const config = parseControlConfig(process.env);
  return createAgentGet(config, createControlRepository(config))(request, context);
}
