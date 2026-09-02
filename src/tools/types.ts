import type { ToolDef } from '../proxy/protocolAdapters/types.js';

export interface ToolHandlerResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ToolHandler = (args: any, agentId: string) => Promise<ToolHandlerResult>;

export interface RegisteredTool {
  definition: ToolDef;
  handler: ToolHandler;
}
