export interface IMMessageOptions {
  messageType?: 'text' | 'markdown';
  mentionedUsers?: string[];
}

export interface IMInboundMessage {
  text: string;
  fromUser: string;
  timestamp: number;
}

export interface IMAdapter {
  send(message: string, opts?: IMMessageOptions): Promise<void>;
  onMessage(handler: (msg: IMInboundMessage) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
