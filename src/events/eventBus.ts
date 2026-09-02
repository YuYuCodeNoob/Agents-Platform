import { EventEmitter } from 'events';
import type { GatewayEvent, EventType } from './types.js';

class EventBus extends EventEmitter {
  emitEvent(type: EventType, agentId: string | undefined, data: Record<string, unknown>): void {
    const event: GatewayEvent = {
      type,
      agentId,
      data,
      timestamp: Date.now(),
    };
    this.emit(type, event);
    this.emit('*', event);
  }

  onEvent(type: EventType | '*', handler: (event: GatewayEvent) => void): void {
    this.on(type, handler);
  }

  offEvent(type: EventType | '*', handler: (event: GatewayEvent) => void): void {
    this.off(type, handler);
  }
}

export const eventBus = new EventBus();
