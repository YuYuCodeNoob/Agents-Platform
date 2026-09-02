import type { InjectionHook, HookResult, InjectionContext, AgentContext, ContentBlock, AgentTool, CacheStrategy } from './types.js';
import type { ProtocolAdapter } from '../proxy/protocolAdapters/types.js';

interface CachedBlock {
  hookId: string;
  blocks: ContentBlock[];
  tools: AgentTool[];
}

export class InjectionPipeline {
  private hooks: InjectionHook[] = [];
  private cache = new Map<string, CachedBlock>();

  add(hook: InjectionHook): void {
    this.hooks.push(hook);
    this.hooks.sort((a, b) => a.priority - b.priority);
  }

  remove(id: string): void {
    this.hooks = this.hooks.filter((h) => h.id !== id);
    this.cache.delete(id);
  }

  async process(
    requestBody: any,
    adapter: ProtocolAdapter,
    agentId?: string,
    agentType?: string,
    sessionId?: string
  ): Promise<any> {
    const ctx = this.parseToContext(requestBody, adapter);
    const isFirstTurn = ctx.messages.filter((m) => m.role === 'user').length <= 1;

    const injCtx: InjectionContext = {
      agentId,
      agentType,
      sessionId,
      context: ctx,
      isFirstTurn,
    };

    await this.executeHooks(injCtx, adapter);

    return this.serializeFromContext(ctx, adapter);
  }

  private parseToContext(body: any, adapter: ProtocolAdapter): AgentContext {
    if (adapter.getProtocolName() === 'openai') {
      const messages: ContentBlock[] = (body.messages ?? []).map((m: any) => ({
        role: m.role,
        text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      }));
      const tools: AgentTool[] = (body.tools ?? []).map((t: any) => ({
        name: t.function?.name ?? t.name,
        description: t.function?.description ?? t.description ?? '',
        inputSchema: t.function?.parameters ?? t.input_schema ?? {},
      }));
      const systemMsg = messages.find((m) => m.role === 'system');
      return {
        messages: systemMsg ? messages.filter((m) => m.role !== 'system') : messages,
        tools,
        systemPrompt: systemMsg?.text,
        requestParams: body,
      };
    }
    if (adapter.getProtocolName() === 'anthropic') {
      const messages: ContentBlock[] = (body.messages ?? []).map((m: any) => ({
        role: m.role,
        text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      }));
      const tools: AgentTool[] = (body.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.input_schema ?? {},
      }));
      return {
        messages,
        tools,
        systemPrompt: typeof body.system === 'string' ? body.system : undefined,
        requestParams: body,
      };
    }
    return { messages: [], tools: [] };
  }

  private serializeFromContext(ctx: AgentContext, adapter: ProtocolAdapter): any {
    const original = ctx.requestParams ?? {};

    if (adapter.getProtocolName() === 'openai') {
      const messages = ctx.systemPrompt
        ? [{ role: 'system', content: ctx.systemPrompt }, ...ctx.messages.map((m) => ({ role: m.role, content: m.text }))]
        : ctx.messages.map((m) => ({ role: m.role, content: m.text }));

      const tools = ctx.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      return { ...original, messages, tools };
    }

    if (adapter.getProtocolName() === 'anthropic') {
      return {
        ...original,
        system: ctx.systemPrompt ?? '',
        messages: ctx.messages.map((m) => ({ role: m.role, content: m.text })),
        tools: ctx.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      };
    }

    return original;
  }

  private async executeHooks(ctx: InjectionContext, _adapter: ProtocolAdapter): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hook of this.hooks) {
      try {
        if (hook.cacheStrategy !== 'none' && !ctx.isFirstTurn) {
          const cached = this.getCache(hook.id, ctx);
          if (cached) {
            this.applyResult(ctx, hook, cached.blocks, cached.tools);
            results.push({ hookId: hook.id, blocks: cached.blocks, tools: cached.tools, cached: true });
            continue;
          }
        }

        const result = await hook.execute(ctx);
        const blocks = Array.isArray(result) && result.length > 0 && 'role' in result[0]
          ? result as ContentBlock[]
          : undefined;
        const tools = Array.isArray(result) && result.length > 0 && 'name' in result[0]
          ? result as AgentTool[]
          : undefined;

        if (blocks || tools) {
          if (hook.cacheStrategy !== 'none' && ctx.isFirstTurn) {
            this.setCache(hook.id, ctx, blocks, tools);
          }
          this.applyResult(ctx, hook, blocks, tools);
        }

        results.push({ hookId: hook.id, blocks, tools });
      } catch (err) {
        console.error(`[Injection] Hook "${hook.id}" failed:`, err);
        results.push({ hookId: hook.id, error: String(err) });
      }
    }

    return results;
  }

  private applyResult(
    ctx: InjectionContext,
    hook: InjectionHook,
    blocks?: ContentBlock[],
    tools?: AgentTool[]
  ): void {
    if (blocks) {
      for (const block of blocks) {
        if (hook.slot.startsWith('system')) {
          ctx.context.systemPrompt = (ctx.context.systemPrompt ?? '') + block.text;
        } else if (hook.slot.startsWith('user')) {
          if (hook.slot === 'user.before') {
            ctx.context.messages.unshift(block);
          } else {
            ctx.context.messages.push(block);
          }
        }
      }
    }

    if (tools) {
      if (hook.slot === 'tools.prepend') {
        ctx.context.tools.unshift(...tools);
      } else {
        ctx.context.tools.push(...tools);
      }
    }
  }

  private getCache(hookId: string, ctx: InjectionContext): CachedBlock | undefined {
    const key = this.cacheKey(hookId, ctx);
    return this.cache.get(key);
  }

  private setCache(
    hookId: string,
    ctx: InjectionContext,
    blocks?: ContentBlock[],
    tools?: AgentTool[]
  ): void {
    const key = this.cacheKey(hookId, ctx);
    this.cache.set(key, { hookId, blocks: blocks ?? [], tools: tools ?? [] });
  }

  private cacheKey(hookId: string, ctx: InjectionContext): string {
    return `${ctx.sessionId ?? 'default'}:${ctx.agentId ?? 'default'}:${hookId}`;
  }

  async prewarm(ctx: { agentId?: string; sessionId?: string }): Promise<void> {
    const initCtx: InjectionContext = {
      agentId: ctx.agentId,
      sessionId: ctx.sessionId,
      context: { messages: [], tools: [] },
      isFirstTurn: true,
    };

    const warmHooks = this.hooks.filter((h) => h.cacheStrategy !== 'none');
    await Promise.allSettled(
      warmHooks.map(async (hook) => {
        try {
          const result = await hook.execute(initCtx);
          if (result) {
            const blocks = Array.isArray(result) && result.length > 0 && 'role' in result[0]
              ? result as ContentBlock[]
              : undefined;
            const tools = Array.isArray(result) && result.length > 0 && 'name' in result[0]
              ? result as AgentTool[]
              : undefined;
            if (blocks || tools) {
              this.setCache(hook.id, initCtx, blocks, tools);
            }
          }
        } catch (err) {
          console.warn(`[Injection] Prewarm hook "${hook.id}" failed:`, err);
        }
      })
    );
  }

  setEnabled(id: string, _enabled: boolean): void {
    // Toggle hook enabled state
  }
}

// Backward-compatible export
export class InjectionEngine {
  private pipeline: InjectionPipeline;

  constructor() {
    this.pipeline = new InjectionPipeline();
  }

  add(hook: InjectionHook): void {
    this.pipeline.add(hook);
  }

  remove(id: string): void {
    this.pipeline.remove(id);
  }

  async apply(
    requestBody: any,
    opts: { adapter: ProtocolAdapter; agentId?: string; agentType?: string }
  ): Promise<any> {
    return this.pipeline.process(requestBody, opts.adapter, opts.agentId, opts.agentType);
  }

  async prewarm(agentId?: string, sessionId?: string): Promise<void> {
    await this.pipeline.prewarm({ agentId, sessionId });
  }

  setEnabled(id: string, enabled: boolean): void {
    this.pipeline.setEnabled(id, enabled);
  }
}
