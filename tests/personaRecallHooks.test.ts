import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { PersonaInjectionHook } from '../src/injection/personaInjectionHook.js';
import { AutoRecallHook } from '../src/injection/autoRecallHook.js';
import { InjectionPipeline } from '../src/injection/injectionEngine.js';
import { OpenAIAdapter } from '../src/proxy/protocolAdapters/openaiAdapter.js';
import type { MemoryQuery, MemoryResult } from '../src/memory/types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'gw-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeMockMemory(results: MemoryResult[]) {
  return {
    query: vi.fn(async (q: MemoryQuery) => results),
  };
}

import { vi } from 'vitest';

describe('PersonaInjectionHook', () => {
  test('returns null when no agentId', async () => {
    const hook = new PersonaInjectionHook(tempDir);
    const result = await hook.execute({
      agentId: undefined,
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });
    expect(result).toBeNull();
  });

  test('returns null when persona file does not exist', async () => {
    const hook = new PersonaInjectionHook(tempDir);
    const result = await hook.execute({
      agentId: 'agent-a',
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });
    expect(result).toBeNull();
  });

  test('returns persona content when file exists', async () => {
    const personaContent = '# User Profile\n\nThis is a test persona.';
    await writeFile(join(tempDir, 'agent-a.md'), personaContent, 'utf-8');

    const hook = new PersonaInjectionHook(tempDir);
    const result = await hook.execute({
      agentId: 'agent-a',
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].role).toBe('system');
    expect(result![0].text).toContain('Agent Persona');
    expect(result![0].text).toContain('This is a test persona.');
  });

  test('returns null for empty persona file', async () => {
    await writeFile(join(tempDir, 'agent-a.md'), '   \n  \n  ', 'utf-8');

    const hook = new PersonaInjectionHook(tempDir);
    const result = await hook.execute({
      agentId: 'agent-a',
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
  });

  test('injects into system prompt suffix in pipeline', async () => {
    const personaContent = '# Persona\n\nTest persona content.';
    await writeFile(join(tempDir, 'agent-b.md'), personaContent, 'utf-8');

    const pipeline = new InjectionPipeline();
    pipeline.add(new PersonaInjectionHook(tempDir));

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [
        { role: 'system', content: 'Original prompt.' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = await pipeline.process(body, adapter, 'agent-b');
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toContain('Original prompt.');
    expect(result.messages[0].content).toContain('Agent Persona');
    expect(result.messages[0].content).toContain('Test persona content.');
  });
});

describe('AutoRecallHook', () => {
  test('returns null when no agentId', async () => {
    const memory = makeMockMemory([]);
    const hook = new AutoRecallHook(memory as any);

    const result = await hook.execute({
      agentId: undefined,
      context: { messages: [{ role: 'user', text: 'query' }], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
    expect(memory.query).not.toHaveBeenCalled();
  });

  test('returns null when no user message', async () => {
    const memory = makeMockMemory([]);
    const hook = new AutoRecallHook(memory as any);

    const result = await hook.execute({
      agentId: 'agent-a',
      context: { messages: [{ role: 'assistant', text: 'response' }], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
  });

  test('returns null when search returns no results', async () => {
    const memory = makeMockMemory([]);
    const hook = new AutoRecallHook(memory as any);

    const result = await hook.execute({
      agentId: 'agent-a',
      context: { messages: [{ role: 'user', text: 'query' }], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
    expect(memory.query).toHaveBeenCalledWith(expect.objectContaining({
      query: 'query',
      layer: 'structured',
      agentFilter: 'agent-a',
      limit: 5,
    }));
  });

  test('formats and returns search results', async () => {
    const results: MemoryResult[] = [
      { layer: 'structured', content: 'User prefers dark mode', score: 0.92, metadata: { type: 'persona', scene_name: 'ui' } },
      { layer: 'structured', content: 'Works on TypeScript projects', score: 0.75, metadata: { type: 'instruction' } },
    ];
    const memory = makeMockMemory(results);
    const hook = new AutoRecallHook(memory as any);

    const result = await hook.execute({
      agentId: 'agent-a',
      context: { messages: [{ role: 'user', text: 'How should I style the app?' }], tools: [] },
      isFirstTurn: false,
    });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].role).toBe('user');
    expect(result![0].text).toContain('2 results');
    expect(result![0].text).toContain('User prefers dark mode');
    expect(result![0].text).toContain('Works on TypeScript projects');
    expect(result![0].text).toContain('score: 0.92');
    expect(result![0].text).toContain('[type: persona');
  });

  test('strips code blocks from query', async () => {
    const memory = makeMockMemory([]);
    const hook = new AutoRecallHook(memory as any);

    await hook.execute({
      agentId: 'agent-a',
      context: {
        messages: [{ role: 'user', text: 'Fix this:\n```ts\nconst x = 1;\n```\nand review the function' }],
        tools: [],
      },
      isFirstTurn: false,
    });

    expect(memory.query).toHaveBeenCalledWith(expect.objectContaining({
      query: 'Fix this:\n\nand review the function',
    }));
  });

  test('handles search errors gracefully', async () => {
    const memory = {
      query: vi.fn(async () => { throw new Error('DB error'); }),
    };
    const hook = new AutoRecallHook(memory as any);

    const result = await hook.execute({
      agentId: 'agent-a',
      context: { messages: [{ role: 'user', text: 'query' }], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
  });

  test('injects before last user message in pipeline', async () => {
    const results: MemoryResult[] = [
      { layer: 'structured', content: 'Relevant memory', score: 0.9, metadata: { type: 'episodic' } },
    ];
    const memory = makeMockMemory(results);

    const pipeline = new InjectionPipeline();
    pipeline.add(new AutoRecallHook(memory as any));

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: 'Thanks' },
      ],
    };

    const result = await pipeline.process(body, adapter, 'agent-a');

    const userMessages = result.messages.filter((m: any) => m.role === 'user');
    expect(userMessages).toHaveLength(3);
    expect(userMessages[0].content).toBe('What is 2+2?');
    expect(userMessages[1].content).toContain('Relevant memory');
    expect(userMessages[2].content).toBe('Thanks');
  });
});
