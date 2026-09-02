import type { IncomingMessage, ServerResponse } from 'http';
import type { ProtocolAdapter, LLMConfig } from './protocolAdapters/types.js';
import type { InjectionEngine } from '../injection/injectionEngine.js';
import type { MemoryPipeline } from '../memory/pipeline.js';
import { eventBus } from '../events/eventBus.js';
import { readJsonBody, sendJson, getAgentId } from '../server/httpUtils.js';
import { agentRegistry } from '../agents/agentRegistry.js';

export class LLMProxyHandler {
  private adapters: ProtocolAdapter[];
  private injectionEngine: InjectionEngine;
  private memory: MemoryPipeline;
  private llmConfigs: Record<string, LLMConfig>;

  constructor(
    adapters: ProtocolAdapter[],
    injectionEngine: InjectionEngine,
    memory: MemoryPipeline,
    llmConfigs: Record<string, LLMConfig>
  ) {
    this.adapters = adapters;
    this.injectionEngine = injectionEngine;
    this.memory = memory;
    this.llmConfigs = llmConfigs;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url ?? '/';
    const agentId = getAgentId(req);
    const authHeader = req.headers['authorization'] as string | undefined;

    const adapter = this.adapters.find((a) => a.match(path, req.headers));
    if (!adapter) {
      sendJson(res, 404, { error: `No protocol adapter matched path: ${path}` });
      return;
    }

    const protocolName = adapter.getProtocolName();
    const llmConfig = this.llmConfigs[protocolName];
    if (!llmConfig) {
      sendJson(res, 500, { error: `No LLM config for protocol: ${protocolName}` });
      return;
    }

    const requestBody = await readJsonBody<Record<string, unknown>>(req);

    if (agentId) {
      agentRegistry.touch(agentId);
    }

    eventBus.emitEvent('llm.request', agentId, {
      protocol: protocolName,
      path,
      model: requestBody.model,
    });

    const injectedBody = await this.injectionEngine.apply(requestBody, {
      agentId,
      adapter,
    });

    const targetUrl = adapter.getTargetUrl(path, llmConfig);

    try {
      const response = await fetch(targetUrl, {
        method: req.method ?? 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(process.env.ANTHROPIC_API_KEY && protocolName === 'anthropic'
            ? { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }
            : {}),
        },
        body: JSON.stringify(injectedBody),
      });

      const responseText = await response.text();
      let responseBody: any;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = { raw: responseText };
      }

      if (agentId) {
        const conversation = adapter.extractConversation(responseBody, agentId);
        this.memory.storeConversation(conversation).catch((err) => {
          console.error('[LLM Proxy] Memory extraction error:', err);
          eventBus.emitEvent('warning', agentId, { error: 'Memory extraction failed', detail: String(err) });
        });

        eventBus.emitEvent('llm.response', agentId, {
          protocol: protocolName,
          model: responseBody.model,
          status: response.status,
        });
      }

      sendJson(res, response.status, responseBody);
    } catch (err) {
      eventBus.emitEvent('error', agentId, { error: 'LLM forward failed', detail: String(err) });
      sendJson(res, 502, { error: 'Failed to forward request to LLM API', detail: String(err) });
    }
  }
}
