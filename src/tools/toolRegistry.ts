import type { ToolDef } from '../proxy/protocolAdapters/types.js';
import type { RegisteredTool, ToolHandler } from './types.js';

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(name: string, definition: ToolDef, handler: ToolHandler): void {
    this.tools.set(name, { definition, handler });
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAllDefinitions(): ToolDef[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  async execute(name: string, args: any, agentId: string) {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool '${name}' not found` };
    }
    return tool.handler(args, agentId);
  }
}

export const toolRegistry = new ToolRegistry();
