import * as lark from '@larksuiteoapi/node-sdk';
import type { IMAdapter, IMInboundMessage, IMMessageOptions } from '../types.js';

export interface FeishuAdapterConfig {
  appId: string;
  appSecret: string;
  chatId?: string;
  verificationToken?: string;
  encryptKey?: string;
  redirectUri?: string;
}

export interface ChatInfo {
  chatId: string;
  name: string;
  description?: string;
}

export class FeishuIMAdapter implements IMAdapter {
  private client: lark.Client;
  private wsClient?: lark.WSClient;
  private appId: string;
  private appSecret: string;
  private chatId: string | undefined;
  private verificationToken: string | undefined;
  private encryptKey: string | undefined;
  private redirectUri: string | undefined;
  private messageHandler?: (msg: IMInboundMessage) => void;
  private started = false;

  constructor(config: FeishuAdapterConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
    });
    this.chatId = config.chatId;
    this.verificationToken = config.verificationToken;
    this.encryptKey = config.encryptKey;
    this.redirectUri = config.redirectUri;
  }

  getChatId(): string | undefined {
    return this.chatId;
  }

  setChatId(chatId: string): void {
    this.chatId = chatId;
  }

  getAuthUrl(state?: string): string {
    const redirect = this.redirectUri ?? `http://127.0.0.1:9800/gateway/feishu/callback`;
    const params = new URLSearchParams({
      app_id: this.appId,
      redirect_uri: redirect,
      response_type: 'code',
      state: state ?? `gw_${Date.now()}`,
    });
    return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`;
  }

  async discoverChats(): Promise<ChatInfo[]> {
    const chats: ChatInfo[] = [];
    let pageToken: string | undefined;

    do {
      const resp = await this.client.im.chat.list({
        params: {
          page_size: 50,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });

      if (resp.code !== 0) {
        console.error('[IM/Feishu] chat.list error:', resp.msg);
        break;
      }

      const items = resp.data?.items ?? [];
      for (const item of items) {
        if (item.chat_mode === 'group' && item.chat_id) {
          chats.push({
            chatId: item.chat_id,
            name: item.name ?? '',
            description: item.description,
          });
        }
      }

      pageToken = resp.data?.page_token && resp.data?.has_more ? resp.data.page_token : undefined;
    } while (pageToken);

    return chats;
  }

  async createChat(name: string, description?: string): Promise<ChatInfo | null> {
    try {
      const resp = await this.client.im.chat.create({
        data: {
          name,
          description,
          chat_mode: 'group',
          chat_type: 'named',
        },
      });

      if (resp.code !== 0 || !resp.data?.chat_id) {
        console.error('[IM/Feishu] chat.create error:', resp.msg);
        return null;
      }

      return {
        chatId: resp.data.chat_id,
        name,
        description,
      };
    } catch (err) {
      console.error('[IM/Feishu] chat.create failed:', err);
      return null;
    }
  }

  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    openId?: string;
  } | null> {
    try {
      const resp = await this.client.authen.accessToken.create({
        data: {
          grant_type: 'authorization_code',
          code,
        },
      });

      if (resp.code !== 0 || !resp.data?.access_token) {
        console.error('[IM/Feishu] token exchange error:', resp.msg);
        return null;
      }

      return {
        accessToken: resp.data.access_token,
        refreshToken: resp.data.refresh_token,
        openId: resp.data.open_id,
      };
    } catch (err) {
      console.error('[IM/Feishu] token exchange failed:', err);
      return null;
    }
  }

  async ensureChatId(): Promise<boolean> {
    if (this.chatId) return true;

    const chats = await this.discoverChats();
    if (chats.length > 0) {
      this.chatId = chats[0].chatId;
      console.log(`[IM/Feishu] Discovered chat: ${chats[0].name} (${this.chatId})`);
      return true;
    }

    const created = await this.createChat('Gateway Proxy');
    if (created) {
      this.chatId = created.chatId;
      console.log(`[IM/Feishu] Created chat: ${created.name} (${created.chatId})`);
      return true;
    }

    return false;
  }

  async send(message: string, _opts?: IMMessageOptions): Promise<void> {
    if (!this.chatId) {
      const ok = await this.ensureChatId();
      if (!ok) {
        console.warn('[IM/Feishu] No chatId available. Visit this URL to authorize:');
        console.warn(`  ${this.getAuthUrl()}`);
        return;
      }
    }

    const content = JSON.stringify({ text: message });

    try {
      await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: this.chatId!,
          msg_type: 'text',
          content,
        },
      });
    } catch (err) {
      console.error('[IM/Feishu] Send failed:', err);
    }
  }

  onMessage(handler: (msg: IMInboundMessage) => void): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    if (this.started) return;

    if (!this.chatId) {
      const ok = await this.ensureChatId();
      if (!ok) {
        console.log('[IM/Feishu] No chat found. Authorization URL:');
        console.log(`  ${this.getAuthUrl()}`);
        console.log('[IM/Feishu] Starting WebSocket listener anyway — messages will be received once bot is added to a group.');
      }
    }

    const dispatcher = new lark.EventDispatcher({
      verificationToken: this.verificationToken,
      encryptKey: this.encryptKey,
    });

    dispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        const msgType = data?.message?.message_type;
        if (msgType !== 'text') return;

        let text = '';
        try {
          const content = JSON.parse(data.message.content || '{}');
          text = content.text || '';
        } catch {
          text = '';
        }

        const fromUser =
          data?.sender?.sender_id?.open_id ||
          data?.sender?.sender_id?.user_id ||
          'unknown';
        const timestamp = data?.message?.create_time
          ? parseInt(data.message.create_time, 10) * 1000
          : Date.now();

        if (this.messageHandler && text) {
          this.messageHandler({ text, fromUser, timestamp });
        }
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
    });

    await this.wsClient.start({ eventDispatcher: dispatcher });
    this.started = true;
    console.log('[IM/Feishu] WebSocket client started');
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close();
    }
    this.started = false;
    console.log('[IM/Feishu] Adapter stopped');
  }
}
