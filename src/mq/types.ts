export type MessageType = 'task' | 'callback' | 'chat' | 'command';

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: MessageType;
  body: string;
  replyTo?: string;
  timestamp: number;
}

export interface SendMessageRequest {
  to: string;
  body: string;
  type?: MessageType;
  replyTo?: string;
}
