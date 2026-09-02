import { describe, test, expect } from 'vitest';
import { InjectionEngine } from '../src/injection/injectionEngine.js';
import { SystemPromptSuffixHook } from '../src/injection/systemPromptInjector.js';
import { ToolListAppendHook } from '../src/injection/toolListInjector.js';
import { OpenAIAdapter } from '../src/proxy/protocolAdapters/openaiAdapter.js';
import type { ToolDef } from '../src/proxy/protocolAdapters/types.js';

const mockTools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'gateway_test',
      description: 'Test tool',
      parameters: { type: 'object', properties: {} },
    },
  },
];

describe('InjectionEngine', () => {
  test('applies injection hooks in order (suffix only)', async () => {
    const engine = new InjectionEngine();
    engine.add(new SystemPromptSuffixHook());
    engine.add(new ToolListAppendHook(mockTools));

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [
        { role: 'system', content: 'Original prompt.' },
        { role: 'user', content: 'Hello' },
      ],
      tools: [{ type: 'function', function: { name: 'existing_tool', description: '', parameters: { type: 'object', properties: {} } } }],
    };

    const result = await engine.apply(body, { adapter });

    expect(result.messages[0].content).toContain('Original prompt.');
    expect(result.messages[0].content).toContain('Gateway Tools');
    expect(result.tools[0].function.name).toBe('existing_tool');
    expect(result.tools[1].function.name).toBe('gateway_test');
  });

  test('preserves original tools as prefix', async () => {
    const engine = new InjectionEngine();
    engine.add(new ToolListAppendHook(mockTools));

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{ type: 'function', function: { name: 'original', description: '', parameters: { type: 'object', properties: {} } } }],
    };

    const result = await engine.apply(body, { adapter });
    expect(result.tools[0].function.name).toBe('original');
    expect(result.tools[1].function.name).toBe('gateway_test');
  });
});
