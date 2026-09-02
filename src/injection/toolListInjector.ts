import type { InjectionHook, AgentTool, InjectionContext } from './types.js';
import type { ToolDef } from '../proxy/protocolAdapters/types.js';

export class ToolListAppendHook implements InjectionHook {
  id = 'tool-list-append';
  slot = 'tools.append' as const;
  priority = 200;
  cacheStrategy = 'none' as const;

  constructor(private toolDefs: ToolDef[]) {}

  async execute(_ctx: InjectionContext): Promise<AgentTool[] | null> {
    const tools: AgentTool[] = this.toolDefs.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      inputSchema: t.function.parameters,
    }));
    return tools;
  }
}
