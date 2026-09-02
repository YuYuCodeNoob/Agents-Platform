import type { InjectionHook, ContentBlock, InjectionContext } from './types.js';
import type { MemoryPipeline } from '../memory/pipeline.js';
import { eventBus } from '../events/eventBus.js';

const MAX_QUERY_LEN = 200;
const RECALL_LIMIT = 5;

export class AutoRecallHook implements InjectionHook {
  id = 'auto-recall';
  slot = 'user.before_last' as const;
  priority = 250;
  cacheStrategy = 'none' as const;

  constructor(private memory: MemoryPipeline) {}

  async execute(ctx: InjectionContext): Promise<ContentBlock[] | null> {
    if (!ctx.agentId) return null;

    const query = this.extractQuery(ctx);
    if (!query) return null;

    let results;
    try {
      results = await this.memory.query({
        query,
        layer: 'structured',
        agentFilter: ctx.agentId,
        limit: RECALL_LIMIT,
      });
    } catch (err) {
      eventBus.emitEvent('warning', ctx.agentId, {
        error: 'Auto-recall search failed',
        detail: String(err),
      });
      return null;
    }

    if (results.length === 0) return null;

    const formatted = this.formatResults(results);

    eventBus.emitEvent('memory.extracted', ctx.agentId, {
      layer: 'recall',
      query: query.slice(0, 80),
      results: results.length,
    });

    return [{
      role: 'user',
      text: formatted,
    }];
  }

  private extractQuery(ctx: InjectionContext): string | null {
    const messages = ctx.context.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const text = messages[i].text;
        const cleaned = text
          .replace(/```[\s\S]*?```/g, '')
          .replace(/`[^`]+`/g, '')
          .trim();
        if (cleaned.length === 0) return null;
        return cleaned.slice(0, MAX_QUERY_LEN);
      }
    }
    return null;
  }

  private formatResults(results: Array<{
    content: string;
    score?: number;
    metadata?: Record<string, unknown>;
    layer?: string;
  }>): string {
    const lines: string[] = [
      `[Gateway] Relevant memories retrieved (${results.length} results):`,
      '',
    ];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const score = r.score !== undefined ? r.score.toFixed(2) : 'N/A';
      const type = (r.metadata?.type as string) ?? 'unknown';
      const scene = (r.metadata?.scene_name as string) ?? '';

      lines.push(`### ${i + 1}. (score: ${score}) [type: ${type}${scene ? ` | scene: ${scene}` : ''}]`);
      lines.push(r.content);
      lines.push('');
    }

    lines.push('Review these memories for relevant context before responding.');

    return lines.join('\n');
  }
}
