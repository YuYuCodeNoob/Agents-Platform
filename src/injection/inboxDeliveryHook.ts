import type { InjectionHook, ContentBlock, InjectionContext } from './types.js';
import type { MessageBus } from '../mq/messageBus.js';
import { eventBus } from '../events/eventBus.js';

export class InboxDeliveryHook implements InjectionHook {
  id = 'inbox-delivery';
  slot = 'user.before_last' as const;
  priority = 300;
  cacheStrategy = 'none' as const;

  constructor(private messageBus: MessageBus) {}

  async execute(ctx: InjectionContext): Promise<ContentBlock[] | null> {
    if (!ctx.agentId) {
      return null;
    }

    let messages;
    try {
      messages = await this.messageBus.readInbox(ctx.agentId);
    } catch (err) {
      eventBus.emitEvent('warning', ctx.agentId, {
        error: 'Inbox delivery failed',
        detail: String(err),
      });
      return null;
    }

    if (messages.length === 0) {
      return null;
    }

    const formatted = this.formatMessages(messages);

    eventBus.emitEvent('mq.message.delivered', ctx.agentId, {
      count: messages.length,
      messageIds: messages.map((m) => m.id),
    });

    return [{
      role: 'user',
      text: formatted,
    }];
  }

  private formatMessages(messages: Array<{
    id: string;
    from: string;
    type: string;
    body: string;
    replyTo?: string;
    timestamp: number;
  }>): string {
    const lines: string[] = [
      `[Gateway] You have ${messages.length} unread message(s) from other agents:`,
      '',
    ];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const time = new Date(msg.timestamp).toISOString();
      lines.push(`--- Message ${i + 1} ---`);
      lines.push(`From: ${msg.from}`);
      lines.push(`Type: ${msg.type}`);
      if (msg.replyTo) {
        lines.push(`Reply-To: ${msg.replyTo}`);
      }
      lines.push(`Time: ${time}`);
      lines.push('');
      lines.push(msg.body);
      lines.push('');
    }

    lines.push('Please review and handle these messages. Use gateway_send_message to reply if needed.');

    return lines.join('\n');
  }
}
