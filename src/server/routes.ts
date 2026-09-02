import type { Router } from './router.js';
import type { LLMProxyHandler } from '../proxy/llmProxyHandler.js';
import type { MemoryPipeline } from '../memory/pipeline.js';
import type { MessageBus } from '../mq/messageBus.js';
import { readJsonBody, sendJson, getAgentId } from './httpUtils.js';
import { agentRegistry } from '../agents/agentRegistry.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import type { RegisterAgentRequest } from '../agents/types.js';
import type { SendMessageRequest } from '../mq/types.js';
import { eventBus } from '../events/eventBus.js';

export function setupRoutes(
  router: Router,
  llmProxy: LLMProxyHandler,
  memory: MemoryPipeline,
  mq: MessageBus
): void {
  router.post('/v1/*', async (req, res) => {
    await llmProxy.handle(req, res);
  });

  router.post('/v1/chat/completions', async (req, res) => {
    await llmProxy.handle(req, res);
  });

  router.post('/v1/messages', async (req, res) => {
    await llmProxy.handle(req, res);
  });

  router.post('/gateway/agents/register', async (req, res) => {
    const body = await readJsonBody<RegisterAgentRequest>(req);
    const agent = agentRegistry.register(body);
    sendJson(res, 200, agent);
  });

  router.get('/gateway/agents', async (_req, res) => {
    sendJson(res, 200, agentRegistry.list());
  });

  router.get('/gateway/agents/:id', async (req, res, params) => {
    const agent = agentRegistry.get(params.id);
    if (!agent) {
      sendJson(res, 404, { error: 'Agent not found' });
      return;
    }
    sendJson(res, 200, agent);
  });

  router.post('/gateway/tools/search_memory', async (req, res) => {
    const agentId = getAgentId(req);
    const args = await readJsonBody(req);
    const result = await toolRegistry.execute('gateway_search_memory', args, agentId ?? 'unknown');
    sendJson(res, result.success ? 200 : 400, result);
  });

  router.post('/gateway/tools/send_message', async (req, res) => {
    const agentId = getAgentId(req);
    if (!agentId) {
      sendJson(res, 400, { error: 'X-Agent-Id header required' });
      return;
    }
    const args = await readJsonBody<SendMessageRequest>(req);
    const result = await toolRegistry.execute('gateway_send_message', args, agentId);
    sendJson(res, result.success ? 200 : 400, result);
  });

  router.get('/gateway/tools/inbox', async (req, res) => {
    const agentId = getAgentId(req);
    if (!agentId) {
      sendJson(res, 400, { error: 'X-Agent-Id header required' });
      return;
    }
    const result = await toolRegistry.execute('gateway_check_inbox', {}, agentId);
    sendJson(res, result.success ? 200 : 400, result);
  });

  router.post('/gateway/tools/register_callback', async (req, res) => {
    const agentId = getAgentId(req);
    if (!agentId) {
      sendJson(res, 400, { error: 'X-Agent-Id header required' });
      return;
    }
    const args = await readJsonBody(req);
    const result = await toolRegistry.execute('gateway_register_callback', args, agentId);
    sendJson(res, result.success ? 200 : 400, result);
  });

  router.get('/gateway/tools/agents', async (req, res) => {
    const agentId = getAgentId(req) ?? 'unknown';
    const result = await toolRegistry.execute('gateway_get_agents', {}, agentId);
    sendJson(res, result.success ? 200 : 400, result);
  });

  router.get('/gateway/health', async (_req, res) => {
    sendJson(res, 200, { status: 'ok', agents: agentRegistry.listOnline().length });
  });
}
