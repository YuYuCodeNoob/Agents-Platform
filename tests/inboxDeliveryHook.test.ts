import { describe, test, expect, vi } from 'vitest';
import { InboxDeliveryHook } from '../src/injection/inboxDeliveryHook.js';
import { InjectionPipeline } from '../src/injection/injectionEngine.js';
import { OpenAIAdapter } from '../src/proxy/protocolAdapters/openaiAdapter.js';
import type { AgentMessage } from '../src/mq/types.js';

function makeMockMessageBus(messages: AgentMessage[]) {
  return {
    readInbox: vi.fn(async () => [...messages]),
    peekInbox: vi.fn(async () => [...messages]),
    getInboxCount: vi.fn(async () => messages.length),
    sendToAgent: vi.fn(),
    disconnect: vi.fn(async () => {}),
  };
}

describe('InboxDeliveryHook', () => {
  test('returns null when no agentId', async () => {
    const mq = makeMockMessageBus([{
      id: 'msg_1', from: 'agent-a', to: 'agent-b', type: 'chat', body: 'hi', timestamp: Date.now(),
    }]);
    const hook = new InboxDeliveryHook(mq as any);

    const result = await hook.execute({
      agentId: undefined,
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
    expect(mq.readInbox).not.toHaveBeenCalled();
  });

  test('returns null when inbox is empty', async () => {
    const mq = makeMockMessageBus([]);
    const hook = new InboxDeliveryHook(mq as any);

    const result = await hook.execute({
      agentId: 'agent-b',
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
  });

  test('formats and returns messages', async () => {
    const messages: AgentMessage[] = [
      { id: 'msg_1', from: 'agent-a', to: 'agent-b', type: 'chat', body: 'Hello there', timestamp: 1700000000000 },
      { id: 'msg_2', from: 'agent-c', to: 'agent-b', type: 'task', body: 'Fix the bug', replyTo: 'task_42', timestamp: 1700000001000 },
    ];
    const mq = makeMockMessageBus(messages);
    const hook = new InboxDeliveryHook(mq as any);

    const result = await hook.execute({
      agentId: 'agent-b',
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].role).toBe('user');
    expect(result![0].text).toContain('2 unread message(s)');
    expect(result![0].text).toContain('From: agent-a');
    expect(result![0].text).toContain('Hello there');
    expect(result![0].text).toContain('From: agent-c');
    expect(result![0].text).toContain('Fix the bug');
    expect(result![0].text).toContain('Reply-To: task_42');
    expect(mq.readInbox).toHaveBeenCalledWith('agent-b');
  });

  test('returns null when MessageBus throws (Redis down)', async () => {
    const mq = {
      readInbox: vi.fn(async () => { throw new Error('Redis connection refused'); }),
      peekInbox: vi.fn(),
      getInboxCount: vi.fn(),
      sendToAgent: vi.fn(),
      disconnect: vi.fn(),
    };
    const hook = new InboxDeliveryHook(mq as any);

    const result = await hook.execute({
      agentId: 'agent-b',
      context: { messages: [], tools: [] },
      isFirstTurn: false,
    });

    expect(result).toBeNull();
  });

  test('injects before last user message in pipeline', async () => {
    const messages: AgentMessage[] = [
      { id: 'msg_1', from: 'agent-a', to: 'agent-b', type: 'chat', body: 'ping', timestamp: 1700000000000 },
    ];
    const mq = makeMockMessageBus(messages);

    const pipeline = new InjectionPipeline();
    pipeline.add(new InboxDeliveryHook(mq as any));

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: 'Thanks' },
      ],
    };

    const result = await pipeline.process(body, adapter, 'agent-b');

    const userMessages = result.messages.filter((m: any) => m.role === 'user');
    expect(userMessages).toHaveLength(3);
    expect(userMessages[0].content).toBe('What is 2+2?');
    expect(userMessages[1].content).toContain('[Gateway]');
    expect(userMessages[1].content).toContain('ping');
    expect(userMessages[2].content).toBe('Thanks');

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBe('Thanks');
  });

  test('does not break on single-message conversation', async () => {
    const messages: AgentMessage[] = [
      { id: 'msg_1', from: 'agent-a', to: 'agent-b', type: 'chat', body: 'hello', timestamp: 1700000000000 },
    ];
    const mq = makeMockMessageBus(messages);

    const pipeline = new InjectionPipeline();
    pipeline.add(new InboxDeliveryHook(mq as any));

    const adapter = new OpenAIAdapter();
    const body = {
      messages: [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hi' },
      ],
    };

    const result = await pipeline.process(body, adapter, 'agent-b');

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].content).toContain('[Gateway]');
    expect(result.messages[2].content).toBe('Hi');
  });
});
