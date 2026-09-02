import type { ConversationData } from '../proxy/protocolAdapters/types.js';

export type MemoryLayer = 'raw' | 'structured' | 'skill' | 'personality' | 'all';

export interface MemoryQuery {
  query: string;
  layer?: MemoryLayer;
  agentFilter?: string;
  limit?: number;
}

export interface MemoryResult {
  layer: MemoryLayer;
  agentId?: string;
  content: string;
  score?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface RawMessage {
  agentId: string;
  role: string;
  content: string;
  toolCalls?: unknown[];
  toolCallId?: string;
  model?: string;
  timestamp: number;
}

export interface StructuredRecord {
  id: string;
  agentId: string;
  type: 'fact' | 'summary' | 'entity' | 'relation';
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: Float32Array;
  createdAt: number;
}

export interface SkillRecord {
  name: string;
  agentId: string;
  filePath: string;
  content: string;
}

export interface PersonalityRecord {
  agentId: string;
  filePath: string;
  content: string;
}

export interface IMemoryStore {
  saveRawMessage(msg: RawMessage): Promise<void>;
  saveStructuredRecord(record: StructuredRecord): Promise<void>;
  saveSkill(skill: SkillRecord): Promise<void>;
  savePersonality(personality: PersonalityRecord): Promise<void>;
  query(query: MemoryQuery): Promise<MemoryResult[]>;
}

export type { ConversationData };
