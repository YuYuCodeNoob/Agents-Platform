import type { MemoryResult } from './types.js';

export function rrfMerge<T>(
  lists: T[][],
  getId: (item: T) => string,
  k = 60
): T[] {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = getId(item);
      const rrfScore = 1 / (k + rank + 1);
      const existing = scores.get(id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(id, { item, score: rrfScore });
      }
    });
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

export function bm25RankToScore(rank: number): number {
  if (rank < 0) return 0;
  return rank / (1 + rank);
}

export function limitResults<T extends MemoryResult>(
  results: T[],
  maxCharsPerMemory: number,
  maxTotalChars: number
): T[] {
  const limited: T[] = [];
  let totalChars = 0;

  for (const result of results) {
    const truncated = truncateCodePointSafe(result.content, maxCharsPerMemory);
    if (totalChars + truncated.length > maxTotalChars) break;
    limited.push({ ...result, content: truncated });
    totalChars += truncated.length;
  }

  return limited;
}

function truncateCodePointSafe(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const truncated = str.slice(0, maxLen);
  const lastSurrogate = truncated.search(/[\uD800-\uDBFF]$/);
  if (lastSurrogate >= 0) {
    return truncated.slice(0, lastSurrogate) + '...';
  }
  return truncated + '...';
}
