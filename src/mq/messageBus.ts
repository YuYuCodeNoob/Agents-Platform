import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import type { AgentMessage, SendMessageRequest } from './types.js';
import { eventBus } from '../events/eventBus.js';

export class MessageBus {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  async sendToAgent(toAgentId: string, msg: SendMessageRequest, fromAgentId: string): Promise<AgentMessage> {
    const message: AgentMessage = {
      id: `msg_${randomUUID().slice(0, 12)}`,
      from: fromAgentId,
      to: toAgentId,
      type: msg.type ?? 'chat',
      body: msg.body,
      replyTo: msg.replyTo,
      timestamp: Date.now(),
    };

    const streamKey = `agent:${toAgentId}:inbox`;
    await this.redis.xadd(streamKey, '*', 'message', JSON.stringify(message));

    eventBus.emitEvent('mq.message.sent', fromAgentId, {
      messageId: message.id,
      to: toAgentId,
      type: message.type,
    });

    if (message.type === 'callback') {
      eventBus.emitEvent('task.callback', toAgentId, {
        messageId: message.id,
        from: fromAgentId,
        replyTo: message.replyTo,
      });
    }

    return message;
  }

  async readInbox(agentId: string, count = 10): Promise<AgentMessage[]> {
    const streamKey = `agent:${agentId}:inbox`;
    const results = await this.redis.xrange(streamKey, '-', '+', 'COUNT', count);

    if (results.length > 0) {
      const ids = results.map((r) => r[0]);
      await this.redis.xdel(streamKey, ...ids);
    }

    return results.map(([_id, fields]) => {
      const msgIdx = fields.indexOf('message');
      const messageField = msgIdx >= 0 ? fields[msgIdx + 1] : '{}';
      return JSON.parse(messageField) as AgentMessage;
    });
  }

  async peekInbox(agentId: string, count = 10): Promise<AgentMessage[]> {
    const streamKey = `agent:${agentId}:inbox`;
    const results = await this.redis.xrange(streamKey, '-', '+', 'COUNT', count);

    return results.map(([_id, fields]) => {
      const msgIdx = fields.indexOf('message');
      const messageField = msgIdx >= 0 ? fields[msgIdx + 1] : '{}';
      return JSON.parse(messageField) as AgentMessage;
    });
  }

  async getInboxCount(agentId: string): Promise<number> {
    const streamKey = `agent:${agentId}:inbox`;
    const count = await this.redis.xlen(streamKey);
    return count;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
