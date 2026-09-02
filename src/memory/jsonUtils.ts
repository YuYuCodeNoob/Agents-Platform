export function sanitizeJsonForParse(raw: string): string {
  return raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .replace(/^[^{[]/, '')
    .replace(/[^}\]]$/, '')
    .trim();
}

export function repairExtractionJson(raw: string): string {
  let repaired = raw.replace(/,\s*([}\]])/g, '$1');
  repaired = repaired.replace(/"priority"\s*:\s*([a-zA-Z_]+)/g, (_match, p1) => {
    const numMap: Record<string, number> = {
      critical: 100, high: 90, medium: 70, low: 50,
      negative: -1, absolute: -1,
    };
    return `"priority": ${numMap[p1.toLowerCase()] ?? 70}`;
  });
  return repaired;
}

export function parseExtractionResult(raw: string): unknown {
  const cleaned = sanitizeJsonForParse(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const repaired = repairExtractionJson(cleaned);
    try {
      parsed = JSON.parse(repaired);
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error('Failed to parse extraction result as JSON');
      }
    }
  }
  return parsed;
}

export function normalizeType(type: string): string {
  const lower = type.toLowerCase();
  const map: Record<string, string> = {
    episode: 'episodic',
    preference: 'persona',
    personal: 'persona',
    fact: 'work_fact',
    task: 'work_task',
    method: 'work_method',
    artifact: 'work_artifact',
  };
  return map[lower] ?? lower;
}
