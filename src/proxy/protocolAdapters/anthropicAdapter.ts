import type { ProtocolAdapter, ToolDef, ConversationData, LLMConfig } from './types.js';

export class AnthropicAdapter implements ProtocolAdapter {
  match(path: string): boolean {
    return path.includes('/v1/messages');
  }

  getProtocolName(): string {
    return 'anthropic';
  }

  injectTools(requestBody: any, tools: ToolDef[]): any {
    const existingTools: any[] = Array.isArray(requestBody.tools) ? requestBody.tools : [];

    const anthropicTools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));

    return {
      ...requestBody,
      tools: [...existingTools, ...anthropicTools],
    };
  }

  injectSystemPromptSuffix(requestBody: any, suffix: string): any {
    const existingSystem = typeof requestBody.system === 'string'
      ? requestBody.system
      : Array.isArray(requestBody.system)
        ? requestBody.system.map((c: any) => c.text || '').join('')
        : '';

    return {
      ...requestBody,
      system: existingSystem + suffix,
    };
  }

  extractConversation(responseBody: any, agentId: string): ConversationData {
    const messages: ConversationData['messages'] = [];

    if (responseBody.content) {
      const content = responseBody.content;
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');
        const toolUseParts = content.filter((c: any) => c.type === 'tool_use');

        messages.push({
          role: responseBody.role || 'assistant',
          content: textParts,
          tool_calls: toolUseParts.length > 0 ? toolUseParts : undefined,
        });
      }
    }

    return {
      agentId,
      messages,
      model: responseBody.model,
      timestamp: Date.now(),
    };
  }

  getTargetUrl(path: string, config: LLMConfig): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${config.apiBase}${cleanPath}`;
  }
}
