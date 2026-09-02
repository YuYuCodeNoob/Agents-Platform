import type { IMAdapter, IMInboundMessage } from '../types.js';

export class MockIMAdapter implements IMAdapter {
  private handler?: (msg: IMInboundMessage) => void;

  async send(message: string): Promise<void> {
    console.log(`[IM/Mock] >>> ${message}`);
  }

  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    console.log('[IM/Mock] Adapter started (no real IM connection)');
  }

  async stop(): Promise<void> {
    console.log('[IM/Mock] Adapter stopped');
  }

  simulateInbound(text: string, fromUser = 'user'): void {
    if (this.handler) {
      this.handler({ text, fromUser, timestamp: Date.now() });
    }
  }
}
