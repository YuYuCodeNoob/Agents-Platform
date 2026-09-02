import type { MemoryPromptMode } from './l1-extraction.js';

export interface PersonaPromptParams {
  mode: 'first' | 'incremental';
  promptMode?: MemoryPromptMode;
  currentTime: string;
  totalProcessed: number;
  sceneCount: number;
  changedSceneCount: number;
  changedScenesContent: string;
  existingPersona?: string;
  triggerInfo?: string;
}

export interface PersonaPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

const PERSONA_SYSTEM_PROMPT = `# Persona Architect - Incremental Evolution Protocol

**输出语言**：persona.md 的所有自然语言内容使用与变化场景内容相同的语言；Markdown 语法、文件名保持英文。

## ⛔ 文件操作约束
1. 必须使用文件工具将最终 persona 内容写入 \`persona.md\`
   - 首次/大幅重写：write(path='persona.md', content=完整内容)
   - 增量更新：edit(path='persona.md', edits=[{oldText, newText}])
2. 只能操作 persona.md 这一个文件
3. 无需 read：当前 persona.md 内容已在用户消息中提供

## 🚫 严格禁止
- 禁止过长：总长度不超过 2000 字符
- 禁止过度推测：没提到的信息不要臆想，冷启动阶段保持克制
- 禁止使用非场景来源的信息

## 核心运作逻辑
执行四层深度扫描：

### 🟢 Layer 1: 基础锚点 - 确凿的事实、当前状态
### 🔵 Layer 2: 兴趣图谱 - 用户投入时间/注意力的事物
### 🟡 Layer 3: 交互协议 - 沟通习惯、工作流偏好
### 🔴 Layer 4: 认知内核 - 决策逻辑、矛盾点、终极驱动力

## 输出模板
\`\`\`markdown
# User Narrative Profile

> **Archetype**: [一句话定义]

> **基本信息**
> **长期偏好**

## Chapter 1: Context & Current State (全景语境)
## Chapter 2: The Texture of Life (生活的肌理)
## Chapter 3: Interaction & Cognitive Protocol (交互与认知协议)
### 3.1 沟通策略
### 3.2 决策逻辑
## Chapter 4: Deep Insights & Evolution (深层洞察与演变)
* **矛盾统一性**
* **演变轨迹**
* **涌现特征**: 3-7 个核心特质标签
\`\`\``;

const TEAM_MEMORY_SYSTEM_PROMPT = `# Team Operating Doctrine Architect

## ⛔ 文件操作约束
同 persona.md 操作：write/edit，只操作 persona.md。

## 🚫 严格禁止
- 禁止超过 1200 字
- 禁止项目化碎片
- 禁止流水账
- 禁止低层事实堆积
- 禁止个人画像化

## 核心目标
从 L2 场景中提炼所有工作场合都可复用的：
1. SOP：以后类似任务应该怎么执行
2. Principle：团队长期遵守的工作原则
3. Decision Logic：取舍标准
4. Boundary：不能做的事情
5. Anti-pattern：导致错误的做法
6. Agent Rule：Agent 应遵守的规则

## 过滤标准
通用性、完整性、可执行性、稳定性、精炼性

## 增量更新策略
强化/补充/修正/重构/不改。L3 应持续压缩，保持少而准。

## 输出模板
\`\`\`markdown
# Team Operating Doctrine

> **Operating Thesis**: [一句话概括]

## Core Principles
## Reusable SOPs
## Decision Logic
## Boundaries & Anti-patterns
## Agent Rules

> **最后更新**：[时间] · **来源场景**：[数量] · **记忆总数**：[数量]
\`\`\``;

export function buildPersonaPrompt(params: PersonaPromptParams): PersonaPromptResult {
  const {
    mode,
    promptMode = 'chat',
    currentTime,
    totalProcessed,
    sceneCount,
    changedSceneCount,
    changedScenesContent,
    existingPersona,
    triggerInfo,
  } = params;

  const isCodeMode = promptMode === 'code';
  const modeLabel = mode === 'first' ? '首次生成' : '迭代更新';

  const triggerSection = triggerInfo ? `\n### 触发信息\n${triggerInfo}\n` : '';

  const existingPersonaSection = existingPersona
    ? `\n## 当前 Persona（已预加载）\n\n*以下是现有 persona.md（${existingPersona.length} 字符）：*\n\n\`\`\`markdown\n${existingPersona}\n\`\`\`\n\n---\n`
    : '';

  const iterationGuide = mode === 'incremental'
    ? `\n## 迭代决策指南\n\n面对变化场景，自主判断：强化/补充/修正/重构/不改。\n`
    : '';

  const userPrompt = `**输出语言**：persona.md 使用下方变化场景内容的主导语言。

**更新时间**: ${currentTime}
**模式**: ${modeLabel}
${triggerSection}
## 统计
- 总记忆数: ${totalProcessed} 条
- 场景总数: ${sceneCount} 个
- 变化场景: ${changedSceneCount} 个

---
${changedScenesContent}

${existingPersonaSection}
${iterationGuide}`;

  return {
    systemPrompt: isCodeMode ? TEAM_MEMORY_SYSTEM_PROMPT : PERSONA_SYSTEM_PROMPT,
    userPrompt,
  };
}
