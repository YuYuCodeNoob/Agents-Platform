import { toolRegistry } from './toolRegistry.js';
import { searchMemoryToolDef } from './definitions/searchMemory.js';
import { sendMessageToolDef } from './definitions/sendMessage.js';
import { checkInboxToolDef, registerCallbackToolDef, getAgentsToolDef } from './definitions/miscTools.js';
import { eventBus } from '../events/eventBus.js';
import type { ToolHandlerResult } from './types.js';
import type { MemoryPipeline } from '../memory/pipeline.js';
import type { MessageBus } from '../mq/messageBus.js';
import { agentRegistry } from '../agents/agentRegistry.js';

export function registerAllTools(memory: MemoryPipeline, mq: MessageBus): void {
  toolRegistry.register('gateway_search_memory', searchMemoryToolDef, async (args, agentId) => {
    eventBus.emitEvent('tool.call', agentId, { tool: 'search_memory', args });
    const results = await memory.query({
      query: args.query,
      layer: args.layer ?? 'all',
      agentFilter: args.agentFilter,
      limit: args.limit,
    });
    eventBus.emitEvent('tool.result', agentId, { tool: 'search_memory', resultCount: results.length });
    return { success: true, data: results } as ToolHandlerResult;
  });

  toolRegistry.register('gateway_send_message', sendMessageToolDef, async (args, agentId) => {
    eventBus.emitEvent('tool.call', agentId, { tool: 'send_message', to: args.to });
    const message = await mq.sendToAgent(args.to, {
      to: args.to,
      body: args.body,
      type: args.type,
      replyTo: args.replyTo,
    }, agentId);
    eventBus.emitEvent('tool.result', agentId, { tool: 'send_message', messageId: message.id });
    return { success: true, data: message } as ToolHandlerResult;
  });

  toolRegistry.register('gateway_check_inbox', checkInboxToolDef, async (args, agentId) => {
    eventBus.emitEvent('tool.call', agentId, { tool: 'check_inbox' });
    const messages = await mq.readInbox(agentId, args.count ?? 10);
    eventBus.emitEvent('mq.message.received', agentId, { count: messages.length });
    eventBus.emitEvent('tool.result', agentId, { tool: 'check_inbox', count: messages.length });
    return { success: true, data: messages } as ToolHandlerResult;
  });

  toolRegistry.register('gateway_register_callback', registerCallbackToolDef, async (args, agentId) => {
    eventBus.emitEvent('tool.call', agentId, { tool: 'register_callback', to: args.to });
    const message = await mq.sendToAgent(args.to, {
      to: args.to,
      body: args.body,
      type: 'callback',
      replyTo: args.replyTo,
    }, agentId);
    eventBus.emitEvent('tool.result', agentId, { tool: 'register_callback', messageId: message.id });
    return { success: true, data: message } as ToolHandlerResult;
  });

  toolRegistry.register('gateway_get_agents', getAgentsToolDef, async (_args, agentId) => {
    eventBus.emitEvent('tool.call', agentId, { tool: 'get_agents' });
    const agents = agentRegistry.listOnline();
    eventBus.emitEvent('tool.result', agentId, { tool: 'get_agents', count: agents.length });
    return { success: true, data: agents } as ToolHandlerResult;
  });
}
