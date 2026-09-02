import { loadConfig } from './config/index.js';
import { HttpServer } from './server/httpServer.js';
import { setupRoutes } from './server/routes.js';
import { eventBus } from './events/eventBus.js';
import { OpenAIAdapter } from './proxy/protocolAdapters/openaiAdapter.js';
import { AnthropicAdapter } from './proxy/protocolAdapters/anthropicAdapter.js';
import { InjectionEngine } from './injection/injectionEngine.js';
import { SystemPromptSuffixHook } from './injection/systemPromptInjector.js';
import { ToolListAppendHook } from './injection/toolListInjector.js';
import { InboxDeliveryHook } from './injection/inboxDeliveryHook.js';
import { LLMProxyHandler } from './proxy/llmProxyHandler.js';
import { MemoryPipeline } from './memory/pipeline.js';
import { L1Extractor } from './memory/extraction/l1-extractor.js';
import { createEmbeddingService } from './memory/embedding.js';
import { MessageBus } from './mq/messageBus.js';
import { registerAllTools } from './tools/toolHandlers.js';
import { toolRegistry } from './tools/toolRegistry.js';
import { IMSidecar } from './im/imSidecar.js';
import { MockIMAdapter } from './im/adapters/mockAdapter.js';

async function main() {
  const config = loadConfig();

  const embeddingService = createEmbeddingService({
    apiUrl: config.openaiApiBase,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dimensions: 1536,
  });

  const memory = new MemoryPipeline({
    jsonlDir: config.jsonlDir,
    sqliteDbPath: config.sqliteDbPath,
    skillsDir: config.skillsDir,
    personalityDir: config.personalityDir,
  });
  memory.setEmbeddingService(embeddingService);

  const extractor = new L1Extractor(
    {
      llmApiUrl: config.openaiApiBase,
      llmApiKey: process.env.OPENAI_API_KEY ?? '',
      llmModel: process.env.EXTRACTION_MODEL ?? 'gpt-4o-mini',
      promptMode: 'chat',
    },
    embeddingService
  );
  memory.setExtractor(extractor);

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
  injectionEngine.add(new SystemPromptSuffixHook());
  injectionEngine.add(new ToolListAppendHook(toolRegistry.getAllDefinitions()));
  injectionEngine.add(new InboxDeliveryHook(mq));

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
  console.log(`[Gateway] Vector search: ${memory['sqlite'].isVectorSupported() ? 'enabled' : 'disabled (sqlite-vec not loaded)'}`);
  console.log(`[Gateway] L1 extraction: ${process.env.OPENAI_API_KEY ? 'enabled' : 'disabled (no API key)'}`);
}

main().catch((err) => {
  console.error('[Gateway] Fatal error:', err);
  process.exit(1);
});
