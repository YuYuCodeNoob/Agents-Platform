import { eventBus } from '../events/eventBus.js';
import type { GatewayEvent } from '../events/types.js';
import type { IMAdapter } from './types.js';
import { parseCommand, executeCommand } from './commandParser.js';
import type { MessageBus } from '../mq/messageBus.js';

export class IMSidecar {
  private adapter: IMAdapter;
  private mq: MessageBus;
  private started = false;

  constructor(adapter: IMAdapter, mq: MessageBus) {
    this.adapter = adapter;
    this.mq = mq;
  }

  async start(): Promise<void> {
    await this.adapter.start();
    this.adapter.onMessage(async (msg) => {
      const cmd = parseCommand(msg);
      const result = await executeCommand(cmd, this.mq);
      await this.adapter.send(result);
    });

    eventBus.onEvent('*', (event: GatewayEvent) => {
      this.handleEvent(event).catch((err) => {
        console.error('[IM Sidecar] Error handling event:', err);
      });
    });

    this.started = true;
    console.log('[IM Sidecar] Started — forwarding all events to IM');
  }

  private async handleEvent(event: GatewayEvent): Promise<void> {
    const formatted = this.formatEvent(event);
    if (formatted) {
      await this.adapter.send(formatted);
    }
  }

  private formatEvent(event: GatewayEvent): string | null {
    switch (event.type) {
      case 'agent.registered':
        return `Agent registered: ${event.data.name ?? event.agentId} (${event.data.type ?? 'unknown'})`;
      case 'agent.unregistered':
        return `Agent unregistered: ${event.data.name ?? event.agentId}`;
      case 'llm.request':
        return `[${event.agentId}] LLM request: ${event.data.model ?? ''}`;
      case 'llm.response':
        return `[${event.agentId}] LLM response received`;
      case 'tool.call':
        return `[${event.agentId}] Tool call: ${event.data.tool}`;
      case 'tool.result':
        return `[${event.agentId}] Tool result: ${event.data.tool} (${JSON.stringify(event.data).slice(0, 100)})`;
      case 'mq.message.sent':
        return `[${event.agentId}] → sent message to ${event.data.to} (type: ${event.data.type})`;
      case 'mq.message.received':
        return `[${event.agentId}] ← received ${event.data.count} messages`;
      case 'mq.message.delivered':
        return `[${event.agentId}] ← auto-delivered ${event.data.count} message(s) from inbox`;
      case 'task.callback':
        return `[${event.agentId}] ← callback from ${event.data.from} (reply_to: ${event.data.replyTo})`;
      case 'memory.extracted':
        return `[${event.agentId}] Memory extracted: ${event.data.messageCount} messages`;
      case 'error':
        return `[${event.agentId}] ERROR: ${JSON.stringify(event.data)}`;
      case 'warning':
        return `[${event.agentId}] WARNING: ${JSON.stringify(event.data)}`;
      default:
        return null;
    }
  }

  async stop(): Promise<void> {
    if (this.started) {
      await this.adapter.stop();
      this.started = false;
    }
  }
}
