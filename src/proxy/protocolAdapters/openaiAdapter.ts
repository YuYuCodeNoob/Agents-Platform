import type { ProtocolAdapter, ToolDef, ConversationData, LLMConfig } from './types.js';

export class OpenAIAdapter implements ProtocolAdapter {
  match(path: string): boolean {
    return path.includes('/v1/chat/completions') || path.includes('/v1/completions');
  }

  getProtocolName(): string {
    return 'openai';
  }

  injectTools(requestBody: any, tools: ToolDef[]): any {
    const existingTools: ToolDef[] = Array.isArray(requestBody.tools) ? requestBody.tools : [];
    return {
      ...requestBody,
      tools: [...existingTools, ...tools],
    };
  }

  injectSystemPromptSuffix(requestBody: any, suffix: string): any {
    const messages: any[] = Array.isArray(requestBody.messages) ? requestBody.messages : [];

    const updatedMessages = messages.map((msg, _idx) => {
      if (msg.role === 'system') {
        const content = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || '').join('')
            : '';
        return { ...msg, content: content + suffix };
      }
      return msg;
    });

    if (!messages.some((m) => m.role === 'system')) {
      updatedMessages.unshift({ role: 'system', content: suffix });
    }

    return { ...requestBody, messages: updatedMessages };
  }

  extractConversation(responseBody: any, agentId: string): ConversationData {
    const messages: ConversationData['messages'] = [];

    if (responseBody.choices) {
      for (const choice of responseBody.choices) {
        if (choice.message) {
          messages.push({
            role: choice.message.role || 'assistant',
            content: typeof choice.message.content === 'string'
              ? choice.message.content
              : JSON.stringify(choice.message.content ?? ''),
            tool_calls: choice.message.tool_calls,
          });
        }
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
