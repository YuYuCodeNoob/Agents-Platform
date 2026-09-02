export type InjectionSlot =
  | 'system.prefix'
  | 'system.suffix'
  | 'system.before_tools'
  | 'system.after_tools'
  | 'user.before'
  | 'user.after'
  | 'user.first_turn'
  | 'tools.append'
  | 'tools.prepend';

export type SemanticSlot =
  | 'persona'
  | 'tools'
  | 'skills'
  | 'memory'
  | 'knowledge'
  | 'rules'
  | 'task_context';

export type AnchorRelation = 'before' | 'after' | 'inside_prepend' | 'inside_append';

export type CacheStrategy = 'none' | 'session_init' | 'hybrid';

export interface ContentBlock {
  role: string;
  text: string;
  metadata?: {
    cache_control?: { type: string } | null;
    cacheKey?: string;
    readOnly?: boolean;
  };
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  cacheControl?: { type: string } | null;
}

export interface AgentContext {
  messages: ContentBlock[];
  tools: AgentTool[];
  systemPrompt?: string;
  requestParams?: Record<string, unknown>;
}

export interface InjectionHook {
  id: string;
  slot: InjectionSlot;
  anchor?: { slot: SemanticSlot; relation: AnchorRelation };
  priority: number;
  cacheStrategy: CacheStrategy;
  execute(ctx: InjectionContext): Promise<ContentBlock[] | AgentTool[] | null>;
}

export interface InjectionContext {
  agentId?: string;
  agentType?: string;
  sessionId?: string;
  context: AgentContext;
  isFirstTurn: boolean;
}

export interface HookResult {
  hookId: string;
  blocks?: ContentBlock[];
  tools?: AgentTool[];
  error?: string;
  cached?: boolean;
}
