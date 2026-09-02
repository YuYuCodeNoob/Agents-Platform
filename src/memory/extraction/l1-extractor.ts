import { randomUUID } from 'crypto';
import type { EmbeddingService } from '../embedding.js';
import type { ConversationData } from '../../proxy/protocolAdapters/types.js';
import type { ConversationMessage, MemoryPromptMode } from '../prompts/l1-extraction.js';
import { getExtractMemoriesSystemPrompt, formatExtractionPrompt } from '../prompts/l1-extraction.js';
import { getConflictDetectionSystemPrompt, formatBatchConflictPrompt } from '../prompts/l1-dedup.js';
import type { ExtractedMemory, MemoryRecord } from '../prompts/l1-dedup.js';
import { parseExtractionResult, normalizeType } from '../jsonUtils.js';
import { eventBus } from '../../events/eventBus.js';

export interface ExtractionConfig {
  llmApiUrl: string;
  llmApiKey: string;
  llmModel: string;
  promptMode?: MemoryPromptMode;
  maxBackgroundMessages?: number;
  maxNewMessages?: number;
}

interface LLMCallParams {
  systemPrompt: string;
  userPrompt: string;
}

interface DedupDecision {
  record_id: string;
  action: 'store' | 'update' | 'skip' | 'merge';
  target_ids?: string[];
  merged_content?: string;
  merged_type?: string;
  merged_priority?: number;
  merged_timestamps?: string[];
}

export class L1Extractor {
  constructor(
    private config: ExtractionConfig,
    private embedding: EmbeddingService
  ) {}

  async extract(conversation: ConversationData): Promise<ExtractedMemory[]> {
    const messages: ConversationMessage[] = conversation.messages.map((m, idx) => ({
      id: `msg_${idx}_${randomUUID().slice(0, 8)}`,
      role: m.role,
      content: m.content,
      timestamp: conversation.timestamp,
    }));

    const maxBg = this.config.maxBackgroundMessages ?? 5;
    const maxNew = this.config.maxNewMessages ?? 10;

    const backgroundMessages = messages.slice(0, maxBg);
    const newMessages = messages.slice(Math.max(0, messages.length - maxNew));

    if (newMessages.length === 0) return [];

    const systemPrompt = getExtractMemoriesSystemPrompt(this.config.promptMode ?? 'chat');
    const userPrompt = formatExtractionPrompt({
      newMessages,
      backgroundMessages,
    });

    const result = await this.callLLM({ systemPrompt, userPrompt });
    const parsed = parseExtractionResult(result) as Array<{
      scene_name: string;
      message_ids: string[];
      memories: Array<{
        content: string;
        type: string;
        priority: number;
        source_message_ids: string[];
        metadata: Record<string, unknown>;
      }>;
    }>;

    const extracted: ExtractedMemory[] = [];
    for (const scene of parsed) {
      for (const mem of scene.memories) {
        extracted.push({
          content: mem.content,
          type: normalizeType(mem.type),
          priority: mem.priority,
          scene_name: scene.scene_name,
          source_message_ids: mem.source_message_ids,
          metadata: mem.metadata ?? {},
        });
      }
    }

    eventBus.emitEvent('memory.extracted', conversation.agentId, {
      layer: 'L1',
      extracted: extracted.length,
      scenes: parsed.length,
    });

    return extracted;
  }

  async dedup(
    newMemories: ExtractedMemory[],
    candidates: MemoryRecord[]
  ): Promise<DedupDecision[]> {
    if (newMemories.length === 0) return [];
    if (candidates.length === 0) {
      return newMemories.map((m) => ({ record_id: '', action: 'store' as const }));
    }

    const matches = newMemories.map((m) => ({
      newMemory: { ...m, record_id: randomUUID() },
      candidates: this.findCandidates(m, candidates),
    }));

    const systemPrompt = getConflictDetectionSystemPrompt(this.config.promptMode ?? 'chat');
    const userPrompt = formatBatchConflictPrompt(matches);

    const result = await this.callLLM({ systemPrompt, userPrompt });
    const parsed = parseExtractionResult(result) as DedupDecision[];

    return parsed;
  }

  private findCandidates(memory: ExtractedMemory, candidates: MemoryRecord[]): MemoryRecord[] {
    const filtered = candidates.filter((c) =>
      c.type === memory.type ||
      c.scene_name === memory.scene_name ||
      this.textSimilarity(c.content, memory.content) > 0.3
    );
    return filtered.slice(0, 10);
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = Array.from(wordsA).filter((w) => wordsB.has(w));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size > 0 ? intersection.length / union.size : 0;
  }

  private async callLLM(params: LLMCallParams): Promise<string> {
    const response = await fetch(`${this.config.llmApiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.llmModel,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }

  async embedMemory(content: string): Promise<Float32Array | undefined> {
    if (!this.embedding.isReady()) return undefined;
    try {
      return await this.embedding.embed(content);
    } catch {
      return undefined;
    }
  }
}
