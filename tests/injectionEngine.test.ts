import { describe, test, expect } from 'vitest';
import { InjectionEngine } from '../src/injection/injectionEngine.js';
import { SystemPromptSuffixInjector } from '../src/injection/systemPromptInjector.js';
import { ToolListSuffixInjector } from '../src/injection/toolListInjector.js';
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
  test('applies injection points in order (suffix only)', () => {
    const engine = new InjectionEngine();
    engine.add(new SystemPromptSuffixInjector());
    engine.add(new ToolListSuffixInjector(mockTools));

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [
        { role: 'system', content: 'Original prompt.' },
        { role: 'user', content: 'Hello' },
      ],
      tools: [{ type: 'function', function: { name: 'existing_tool', description: '', parameters: { type: 'object', properties: {} } } }],
    };

    const result = engine.apply(body, { adapter });

    expect(result.messages[0].content).toContain('Original prompt.');
    expect(result.messages[0].content).toContain('Gateway Tools');

    expect(result.tools[0].function.name).toBe('existing_tool');
    expect(result.tools[1].function.name).toBe('gateway_test');
  });

  test('can disable injection points', () => {
    const engine = new InjectionEngine();
    engine.add(new SystemPromptSuffixInjector());
    engine.add(new ToolListSuffixInjector(mockTools));

    engine.setEnabled('SystemPromptSuffix', false);

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [{ role: 'system', content: 'Original.' }],
    };

    const result = engine.apply(body, { adapter });
    expect(result.messages[0].content).toBe('Original.');
    expect(result.tools).toHaveLength(1);
  });
});
