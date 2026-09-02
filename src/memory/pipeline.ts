import type { ConversationData } from '../proxy/protocolAdapters/types.js';
import type { MemoryQuery, MemoryResult, RawMessage } from './types.js';
import { eventBus } from '../events/eventBus.js';
import { JsonlStore } from './jsonlStore.js';
import { SqliteStore } from './sqliteStore.js';
import { MarkdownStore } from './markdownStore.js';

export interface MemoryStoreConfig {
  jsonlDir: string;
  sqliteDbPath: string;
  skillsDir: string;
  personalityDir: string;
}

export class MemoryPipeline {
  private jsonl: JsonlStore;
  private sqlite: SqliteStore;
  private markdown: MarkdownStore;

  constructor(config: MemoryStoreConfig) {
    this.jsonl = new JsonlStore(config.jsonlDir);
    this.sqlite = new SqliteStore(config.sqliteDbPath);
    this.markdown = new MarkdownStore(config.skillsDir, config.personalityDir);
  }

  async storeConversation(conversation: ConversationData): Promise<void> {
    for (const msg of conversation.messages) {
      const raw: RawMessage = {
        agentId: conversation.agentId,
        role: msg.role,
        content: msg.content,
        toolCalls: msg.tool_calls,
        toolCallId: msg.tool_call_id,
        model: conversation.model,
        timestamp: conversation.timestamp,
      };
      await this.jsonl.save(raw);
    }

    eventBus.emitEvent('memory.extracted', conversation.agentId, {
      messageCount: conversation.messages.length,
      model: conversation.model,
    });
  }

  async query(query: MemoryQuery): Promise<MemoryResult[]> {
    const results: MemoryResult[] = [];
    const layer = query.layer ?? 'all';

    if (layer === 'all' || layer === 'raw') {
      const rawResults = await this.jsonl.search(query.query, query.agentFilter, query.limit ?? 20);
      results.push(...rawResults.map((r) => ({
        layer: 'raw' as const,
        agentId: r.agentId,
        content: r.content,
        timestamp: r.timestamp,
      })));
    }

    if (layer === 'all' || layer === 'structured') {
      results.push(...this.sqlite.search(query));
    }

    if (layer === 'all' || layer === 'skill') {
      results.push(...await this.markdown.searchSkills(query.query, query.limit ?? 10));
    }

    if (layer === 'all' || layer === 'personality') {
      results.push(...await this.markdown.searchPersonality(query.query, query.agentFilter, query.limit ?? 10));
    }

    return results.slice(0, query.limit ?? 50);
  }

  close(): void {
    this.sqlite.close();
  }
}
