import type { MemoryPromptMode } from './l1-extraction.js';

export interface MemoryRecord {
  id: string;
  content: string;
  type: string;
  priority: number;
  scene_name: string;
  timestamps: string[];
  metadata?: Record<string, unknown>;
}

export interface ExtractedMemory {
  content: string;
  type: string;
  priority: number;
  scene_name: string;
  source_message_ids: string[];
  metadata: Record<string, unknown>;
}

export const CONFLICT_DETECTION_SYSTEM_PROMPT = `你是记忆冲突检测器。批量比较多条【新记忆】与【统一候选记忆池】中的已有记忆，逐条决定如何处理。

**输出语言**：\`merged_content\` 使用与候选池中已有记忆相同的语言；JSON 字段名、枚举值、record_id保持英文。

## 核心规则
- **跨 type 合并**：不同 type 的记忆如果语义上描述同一事实/事件，可以合并。
- **多对多合并**：一条新记忆可以同时替换/合并候选池中的多条已有记忆（通过 target_ids 数组）。

## 判断逻辑
1. **分辨记忆性质**：状态类（persona/instruction）相对稳定；事件类（episodic）一次性经历。
2. **判断是否同一事实/事件**：主体相同、主题一致、时间接近。
3. **选择动作**：
   - "store"：新信息，新增。
   - "skip"：已有记忆更好，忽略。
   - "update"：同一事实，新记忆更优，覆盖旧记忆。
   - "merge"：多条互补，合并成一条更完整记忆。
4. **timestamp 处理**：merge/update 时，merged_timestamps 应包含所有相关记忆的时间戳并集。

## 输出格式
严格输出 JSON 数组：
[
  {
    "record_id": "新记忆的 record_id",
    "action": "store|update|skip|merge",
    "target_ids": ["要删除的候选记忆 record_id"],
    "merged_content": "合并后的记忆内容（merge/update时必填）",
    "merged_type": "合并后的 type（merge/update时必填）",
    "merged_priority": 85,
    "merged_timestamps": ["时间戳并集"]
  }
]`;

export const WORK_CONFLICT_DETECTION_SYSTEM_PROMPT = `你是团队工作记忆冲突检测器。批量比较多条【新记忆】与【统一候选记忆池】中的已有记忆，逐条决定如何处理。

## 核心规则
- 跨 type 合并：不同 type 的工作记忆如果描述同一工作对象/方法/资产，可以合并。
- 多对多合并：一条新记忆可以同时替换/合并多条已有记忆。

## 判断逻辑
1. 分辨工作记忆性质：work_fact（事实）、work_task（任务）、work_method（方法）、work_artifact（资产）
2. 判断是否同一工作对象/演化过程
3. 选择动作：store/skip/update/merge
4. timestamp 并集

## 输出格式
同上 JSON 数组格式。`;

export function getConflictDetectionSystemPrompt(mode: MemoryPromptMode = 'chat'): string {
  return mode === 'code' ? WORK_CONFLICT_DETECTION_SYSTEM_PROMPT : CONFLICT_DETECTION_SYSTEM_PROMPT;
}

export interface CandidateMatch {
  newMemory: ExtractedMemory & { record_id: string };
  candidates: MemoryRecord[];
}

export function formatBatchConflictPrompt(matches: CandidateMatch[]): string {
  const unifiedPool = new Map<string, MemoryRecord>();
  const perMemoryCandidateIds = new Map<string, string[]>();

  for (const m of matches) {
    const candidateIds: string[] = [];
    for (const c of m.candidates) {
      if (!unifiedPool.has(c.id)) {
        unifiedPool.set(c.id, c);
      }
      candidateIds.push(c.id);
    }
    perMemoryCandidateIds.set(m.newMemory.record_id, candidateIds);
  }

  const poolList = Array.from(unifiedPool.values()).map((c) => ({
    record_id: c.id,
    content: c.content,
    type: c.type,
    priority: c.priority,
    scene_name: c.scene_name,
    timestamps: c.timestamps,
  }));

  let poolSection: string;
  if (poolList.length === 0) {
    poolSection = '## 统一候选记忆池\n\n（空，所有新记忆直接 store）';
  } else {
    const poolStr = JSON.stringify(poolList, null, 2);
    poolSection = `## 统一候选记忆池（共 ${poolList.length} 条已有记忆）\n\n${poolStr}`;
  }

  const memoryParts = matches.map((m, idx) => {
    const relatedIds = perMemoryCandidateIds.get(m.newMemory.record_id) ?? [];
    const relatedNote = relatedIds.length > 0
      ? JSON.stringify(relatedIds)
      : '[]（无相似候选，直接 store）';

    const memStr = JSON.stringify({
      record_id: m.newMemory.record_id,
      content: m.newMemory.content,
      type: m.newMemory.type,
      priority: m.newMemory.priority,
      scene_name: m.newMemory.scene_name,
    }, null, 2);

    return `### 第 ${idx + 1} 条新记忆 (record_id: ${m.newMemory.record_id})\n${memStr}\n\n【关联候选 ID】${relatedNote}`;
  });

  const newMemoriesText = memoryParts.join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');

  return `**输出语言**：\`merged_content\` 使用与候选池中已有记忆相同的语言。

${poolSection}

${'═'.repeat(50)}

## 待判断的新记忆（共 ${matches.length} 条）

${newMemoriesText}

请逐条判断并输出决策 JSON 数组。当某条新记忆的候选列表为空时，该条直接输出 action=store。`;
}
