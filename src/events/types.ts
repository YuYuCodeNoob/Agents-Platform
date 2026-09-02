export type EventType =
  | 'agent.registered'
  | 'agent.unregistered'
  | 'llm.request'
  | 'llm.response'
  | 'tool.call'
  | 'tool.result'
  | 'mq.message.sent'
  | 'mq.message.received'
  | 'task.callback'
  | 'memory.extracted'
  | 'error'
  | 'warning';

export interface GatewayEvent {
  type: EventType;
  agentId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}
