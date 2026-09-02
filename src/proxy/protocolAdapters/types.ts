export interface ToolDef {
  type?: string;
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ConversationData {
  agentId: string;
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  model?: string;
  timestamp: number;
}

export interface LLMConfig {
  apiBase: string;
  apiKey?: string;
  provider: string;
  model?: string;
}

export interface ProtocolAdapter {
  match(path: string, headers: Record<string, string | string[] | undefined>): boolean;
  injectTools(requestBody: any, tools: ToolDef[]): any;
  injectSystemPromptSuffix(requestBody: any, suffix: string): any;
  extractConversation(responseBody: any, agentId: string): ConversationData;
  getTargetUrl(path: string, config: LLMConfig): string;
  getProtocolName(): string;
}
