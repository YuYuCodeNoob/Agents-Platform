import type { RawMessage } from './types.js';

const INJECTION_TAG_PATTERNS = [
  /## Gateway Tools[\s\S]*?(?=\n##|\n---|\n$|$)/g,
  /<tdai_memory_tools>[\s\S]*?<\/tdai_memory_tools>/g,
  /<tdai_profile_memory>[\s\S]*?<\/tdai_profile_memory>/g,
  /<CUSTOM_MEMORY_STRATEGY>[\s\S]*?<\/CUSTOM_MEMORY_STRATEGY>/g,
  /-----META-START-----[\s\S]*?-----META-END-----/g,
];

const MIN_CONTENT_LENGTH = 3;
const MAX_CONTENT_LENGTH = 50000;
const COMMAND_PATTERNS = [
  /^(curl|npm|npx|pip|python|node|go|cargo|git)\s/i,
  /^```/,
];

export function sanitizeText(content: string): string {
  let cleaned = content;
  for (const pattern of INJECTION_TAG_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

export function shouldCaptureL0(msg: RawMessage): boolean {
  const content = msg.content?.trim();
  if (!content) return false;
  if (content.length < MIN_CONTENT_LENGTH) return false;
  if (content.length > MAX_CONTENT_LENGTH) return false;
  for (const pattern of COMMAND_PATTERNS) {
    if (pattern.test(content)) return false;
  }
  return true;
}

export function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '').trim();
}

export function sanitizeConversation(messages: RawMessage[]): RawMessage[] {
  return messages
    .map((m) => ({ ...m, content: sanitizeText(m.content) }))
    .filter(shouldCaptureL0)
    .map((m) => ({
      ...m,
      content: m.role === 'assistant' ? stripCodeBlocks(m.content) : m.content,
    }));
}
