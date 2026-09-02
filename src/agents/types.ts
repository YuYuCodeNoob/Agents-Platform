export type AgentType = 'codex' | 'claude-code' | 'opencode' | 'hermes' | 'custom';

export interface AgentInfo {
  id: string;
  name: string;
  type: AgentType;
  status: 'online' | 'offline';
  registeredAt: number;
  lastSeen: number;
  llmConfig?: {
    provider: string;
    model?: string;
  };
}

export interface RegisterAgentRequest {
  name: string;
  type: AgentType;
  llmConfig?: {
    provider: string;
    model?: string;
  };
}
