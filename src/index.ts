import { loadConfig } from './config/index.js';
import { HttpServer } from './server/httpServer.js';
import { setupRoutes } from './server/routes.js';
import { eventBus } from './events/eventBus.js';
import { OpenAIAdapter } from './proxy/protocolAdapters/openaiAdapter.js';
import { AnthropicAdapter } from './proxy/protocolAdapters/anthropicAdapter.js';
import { InjectionEngine } from './injection/injectionEngine.js';
import { SystemPromptSuffixInjector } from './injection/systemPromptInjector.js';
import { ToolListSuffixInjector } from './injection/toolListInjector.js';
import { LLMProxyHandler } from './proxy/llmProxyHandler.js';
import { MemoryPipeline } from './memory/pipeline.js';
import { MessageBus } from './mq/messageBus.js';
import { registerAllTools } from './tools/toolHandlers.js';
import { toolRegistry } from './tools/toolRegistry.js';
import { IMSidecar } from './im/imSidecar.js';
import { MockIMAdapter } from './im/adapters/mockAdapter.js';

async function main() {
  const config = loadConfig();

  const memory = new MemoryPipeline({
    jsonlDir: config.jsonlDir,
    sqliteDbPath: config.sqliteDbPath,
    skillsDir: config.skillsDir,
    personalityDir: config.personalityDir,
  });

  let mq: MessageBus;
  try {
    mq = new MessageBus(config.redisUrl);
    await mq.getInboxCount('__health_check__');
    console.log('[Gateway] Redis connected');
  } catch (err) {
    console.warn('[Gateway] Redis not available, MQ features will be limited:', String(err));
    mq = new MessageBus(config.redisUrl);
  }

  registerAllTools(memory, mq);

  const injectionEngine = new InjectionEngine();
  injectionEngine.add(new SystemPromptSuffixInjector());
  injectionEngine.add(new ToolListSuffixInjector(toolRegistry.getAllDefinitions()));

  const adapters = [new OpenAIAdapter(), new AnthropicAdapter()];

  const llmConfigs = {
    openai: {
      apiBase: config.openaiApiBase,
      provider: 'openai',
    },
    anthropic: {
      apiBase: config.anthropicApiBase,
      provider: 'anthropic',
    },
  };

  const llmProxy = new LLMProxyHandler(adapters, injectionEngine, memory, llmConfigs);

  const server = new HttpServer(config);
  setupRoutes(server.router, llmProxy, memory, mq);

  let imSidecar: IMSidecar | undefined;
  if (config.imAdapter === 'mock') {
    const adapter = new MockIMAdapter();
    imSidecar = new IMSidecar(adapter, mq);
    await imSidecar.start();
  }

  process.on('SIGINT', async () => {
    console.log('\n[Gateway] Shutting down...');
    imSidecar?.stop();
    await mq.disconnect();
    memory.close();
    server.stop();
    process.exit(0);
  });

  server.start();
  console.log('[Gateway] All systems ready');
}

main().catch((err) => {
  console.error('[Gateway] Fatal error:', err);
  process.exit(1);
});
