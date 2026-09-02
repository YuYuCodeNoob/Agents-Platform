import { randomUUID } from 'crypto';
import type { ConversationData } from '../proxy/protocolAdapters/types.js';
import type { MemoryQuery, MemoryResult, RawMessage, StructuredRecord } from './types.js';
import { eventBus } from '../events/eventBus.js';
import { JsonlStore } from './jsonlStore.js';
import { SqliteStore } from './sqliteStore.js';
import { MarkdownStore } from './markdownStore.js';
import { sanitizeConversation } from './sanitize.js';
import type { L1Extractor } from './extraction/l1-extractor.js';
import type { EmbeddingService } from './embedding.js';
import type { ExtractedMemory, MemoryRecord } from './prompts/l1-dedup.js';

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
  private extractor?: L1Extractor;
  private embedding?: EmbeddingService;

  constructor(config: MemoryStoreConfig) {
    this.jsonl = new JsonlStore(config.jsonlDir);
    this.sqlite = new SqliteStore(config.sqliteDbPath);
    this.markdown = new MarkdownStore(config.skillsDir, config.personalityDir);
  }

  setExtractor(extractor: L1Extractor): void {
    this.extractor = extractor;
  }

  setEmbeddingService(embedding: EmbeddingService): void {
    this.embedding = embedding;
  }

  async storeConversation(conversation: ConversationData): Promise<void> {
    const rawMessages: RawMessage[] = conversation.messages.map((m) => ({
      agentId: conversation.agentId,
      role: m.role,
      content: m.content,
      toolCalls: m.tool_calls,
      toolCallId: m.tool_call_id,
      model: conversation.model,
      timestamp: conversation.timestamp,
    }));

    const sanitized = sanitizeConversation(rawMessages);

    for (const msg of rawMessages) {
      await this.jsonl.save(msg);
    }

    eventBus.emitEvent('memory.extracted', conversation.agentId, {
      layer: 'L0',
      rawCount: rawMessages.length,
      sanitizedCount: sanitized.length,
      model: conversation.model,
    });

    this.extractL1(conversation, sanitized).catch((err) => {
      console.error('[Memory] L1 extraction error:', err);
      eventBus.emitEvent('warning', conversation.agentId, {
        error: 'L1 extraction failed',
        detail: String(err),
      });
    });
  }

  private async extractL1(conversation: ConversationData, sanitized: RawMessage[]): Promise<void> {
    if (!this.extractor || sanitized.length === 0) return;

    const convForExtraction: ConversationData = {
      ...conversation,
      messages: sanitized.map((m) => ({ role: m.role, content: m.content })),
    };

    const extracted = await this.extractor.extract(convForExtraction);
    if (extracted.length === 0) return;

    const candidates = this.getCandidates(extracted, conversation.agentId);
    let decisions;

    if (candidates.length > 0) {
      try {
        decisions = await this.extractor.dedup(extracted, candidates);
      } catch (err) {
        console.error('[Memory] L1 dedup error, storing all directly:', err);
        decisions = extracted.map(() => ({ action: 'store' as const }));
      }
    } else {
      decisions = extracted.map(() => ({ action: 'store' as const }));
    }

    this.applyDedupDecisions(decisions, extracted, conversation.agentId).catch((err) => {
      console.error('[Memory] L1 write error:', err);
    });
  }

  private getCandidates(extracted: ExtractedMemory[], agentId: string): MemoryRecord[] {
    const candidates: MemoryRecord[] = [];
    for (const mem of extracted) {
      const results = this.sqlite.searchKeyword({
        query: mem.content.slice(0, 50),
        agentFilter: agentId,
        limit: 5,
      });
      for (const r of results) {
        candidates.push({
          id: r.metadata?.id as string ?? randomUUID(),
          content: r.content,
          type: r.metadata?.type as string ?? 'unknown',
          priority: r.metadata?.priority as number ?? 50,
          scene_name: r.metadata?.scene_name as string ?? '',
          timestamps: r.metadata?.timestamps as string[] ?? [],
        });
      }
    }
    return candidates;
  }

  private async applyDedupDecisions(
    decisions: Array<{ action: string; target_ids?: string[]; merged_content?: string; merged_type?: string; merged_priority?: number; merged_timestamps?: string[] }>,
    extracted: ExtractedMemory[],
    agentId: string
  ): Promise<void> {
    for (let i = 0; i < extracted.length; i++) {
      const mem = extracted[i];
      const decision = decisions[i] ?? { action: 'store' };

      if (decision.action === 'skip') continue;

      if ((decision.action === 'update' || decision.action === 'merge') && decision.target_ids) {
        for (const targetId of decision.target_ids) {
          this.sqlite.delete(targetId);
        }
      }

      const content = decision.merged_content ?? mem.content;
      const type = decision.merged_type ?? mem.type;
      const priority = decision.merged_priority ?? mem.priority;
      const timestamps = decision.merged_timestamps ?? [new Date().toISOString()];

      const embedding = await this.extractor?.embedMemory(content);

      const record: StructuredRecord = {
        id: randomUUID(),
        agentId,
        type,
        content,
        metadata: {
          priority,
          scene_name: mem.scene_name,
          source_message_ids: mem.source_message_ids,
          timestamps,
          ...mem.metadata,
        },
        embedding,
        createdAt: Date.now(),
      };

      this.sqlite.save(record);
    }

    eventBus.emitEvent('memory.extracted', agentId, {
      layer: 'L1',
      extracted: extracted.length,
      stored: decisions.filter((d) => d.action !== 'skip').length,
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
      let embedding: Float32Array | undefined;
      if (this.embedding?.isReady()) {
        try {
          embedding = await this.embedding.embed(query.query);
        } catch { /* fallback to keyword only */ }
      }
      results.push(...this.sqlite.search(query, embedding));
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
