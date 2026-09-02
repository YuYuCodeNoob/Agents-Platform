import { describe, test, expect } from 'vitest';
import { OpenAIAdapter } from '../src/proxy/protocolAdapters/openaiAdapter.js';
import { AnthropicAdapter } from '../src/proxy/protocolAdapters/anthropicAdapter.js';
import type { ToolDef } from '../src/proxy/protocolAdapters/types.js';

const mockTools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'gateway_search_memory',
      description: 'Search shared memory',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    },
  },
];

describe('OpenAIAdapter', () => {
  const adapter = new OpenAIAdapter();

  test('matches /v1/chat/completions', () => {
    expect(adapter.match('/v1/chat/completions')).toBe(true);
    expect(adapter.match('/v1/messages')).toBe(false);
  });

  test('injects tools as suffix (preserves existing tools)', () => {
    const body = {
      messages: [{ role: 'system', content: 'You are a helper.' }],
      tools: [{ type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: {} } } }],
    };
    const result = adapter.injectTools(body, mockTools);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].function.name).toBe('read_file');
    expect(result.tools[1].function.name).toBe('gateway_search_memory');
  });

  test('injects system prompt as suffix (preserves original content)', () => {
    const body = {
      messages: [{ role: 'system', content: 'Original system prompt.' }],
    };
    const result = adapter.injectSystemPromptSuffix(body, '\n\nGateway suffix.');
    expect(result.messages[0].content).toContain('Original system prompt.');
    expect(result.messages[0].content).toContain('Gateway suffix.');
    expect(result.messages[0].content.startsWith('Original system prompt.')).toBe(true);
  });

  test('extracts conversation from response', () => {
    const response = {
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
    };
    const conv = adapter.extractConversation(response, 'agent_test');
    expect(conv.agentId).toBe('agent_test');
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].content).toBe('Hello!');
    expect(conv.model).toBe('gpt-4');
  });
});

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter();

  test('matches /v1/messages', () => {
    expect(adapter.match('/v1/messages')).toBe(true);
    expect(adapter.match('/v1/chat/completions')).toBe(false);
  });

  test('injects tools in Anthropic format as suffix', () => {
    const body = {
      system: 'You are a helper.',
      tools: [{ name: 'read_file', description: 'Read file', input_schema: { type: 'object', properties: {} } }],
    };
    const result = adapter.injectTools(body, mockTools);
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].name).toBe('read_file');
    expect(result.tools[1].name).toBe('gateway_search_memory');
  });

  test('injects system prompt as suffix', () => {
    const body = { system: 'Original system prompt.' };
    const result = adapter.injectSystemPromptSuffix(body, '\n\nGateway suffix.');
    expect(result.system).toContain('Original system prompt.');
    expect(result.system).toContain('Gateway suffix.');
    expect(result.system.startsWith('Original system prompt.')).toBe(true);
  });
});
