import type { InjectionHook, ContentBlock, InjectionContext } from './types.js';

const GATEWAY_SYSTEM_PROMPT_SUFFIX = `

## Gateway Tools
You have access to shared gateway tools for cross-agent communication and shared memory.
These tools are available alongside your existing tools. To execute them, use curl to call the proxy HTTP endpoints.

Available gateway tools will be listed in your tools/functions list. When you decide to use one,
execute it by sending an HTTP request to the corresponding endpoint:
- POST http://127.0.0.1:9800/gateway/tools/search_memory — Search shared memory
- POST http://127.0.0.1:9800/gateway/tools/send_message — Send message to another agent
- GET  http://127.0.0.1:9800/gateway/tools/inbox — Check your inbox for messages
- POST http://127.0.0.1:9800/gateway/tools/register_callback — Register a task completion callback
- GET  http://127.0.0.1:9800/gateway/tools/agents — List online agents

Always include the X-Agent-Id header in your requests to identify yourself.
`;

export class SystemPromptSuffixHook implements InjectionHook {
  id = 'system-prompt-suffix';
  slot = 'system.suffix' as const;
  anchor = { slot: 'memory' as const, relation: 'after' as const };
  priority = 100;
  cacheStrategy = 'none' as const;

  async execute(_ctx: InjectionContext): Promise<ContentBlock[] | null> {
    return [{
      role: 'system',
      text: GATEWAY_SYSTEM_PROMPT_SUFFIX,
    }];
  }
}
