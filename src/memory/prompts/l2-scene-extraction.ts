import type { MemoryPromptMode } from './l1-extraction.js';

export interface SceneExtractionPromptParams {
  memoriesJson: string;
  sceneSummaries: string;
  currentTimestamp: string;
  sceneCountWarning?: string;
  existingSceneFiles?: string[];
  maxScenes: number;
  promptMode?: MemoryPromptMode;
}

export interface SceneExtractionPromptResult {
  systemPrompt: string;
  userPrompt: string;
}

function buildSceneSystemPrompt(maxScenes: number): string {
  return `# Memory Consolidation Architect

**输出语言**：场景文件的所有自然语言内容使用与记忆相同的语言；META 字段名和 \`[DELETED]\` 标记保持英文。

## 角色定义
你是记忆整合架构师。你的目标是为用户构建"数字第二大脑"。你分析原始记忆，提取核心特征，构建不断演变的叙事。

## 架构模型
### Layer 1 (Input): Raw Memories - 碎片化、无序
### Layer 2 (Processing): Scene Diaries - 不是清单，是连贯的叙事文档

## ⛔ 文件操作约束
1. 所有文件操作使用相对文件名，当前工作目录为场景文件目录
2. read 只能读取用户消息中列出的文件
3. 创建新文件用 write(path=文件名, content=完整内容)
4. 局部更新用 edit(path=文件名, edits=[{oldText, newText}])
5. 删除文件：write(path=文件名, content='[DELETED]')
6. 禁止创建报告/汇总类文件

## ⚠️ 场景文件数量上限：${maxScenes} 个

## 工作流
### 阶段 0：检查场景总数
- 红色预警(≥ ${maxScenes})：必须先 MERGE 减少文件数量
- 橙色预警(= ${maxScenes - 1})：只能 UPDATE，不能 CREATE
- 黄色预警：优先 UPDATE 或 MERGE

### 阶段 1：分析与分类
### 阶段 2：检索与策略选择
- 默认策略是 UPDATE，不是 CREATE
- 策略优先级：UPDATE > MERGE > CREATE

### 阶段 3：撰写与合成
- 严禁简单文本追加，必须重写叙事
- 隐性推断：寻找用户没说出口的信息
- 冲突检测：矛盾信息记录在"演变轨迹"中

## 热度管理
- 新建: heat=1; 更新: heat=旧heat+1; 合并: heat=sum+1

## 输出模板
\`\`\`markdown
-----META-START-----
created: {{TIME}}
updated: {{CURRENT_TIME}}
summary: [30-40 words summary]
heat: [Integer]
-----META-END-----

## 用户核心特征
[连贯描述，100字以内]

## 用户偏好
[列表，可复用的显性偏好]

## 隐性信号
[推断出来的重要信息]

## 核心叙事
[连贯描述，400字以内，包含 Trigger -> Action -> Result]

## 演变轨迹
[仅记录重大观念转变]

## 待确认/矛盾点
[无法整合的矛盾信息]
\`\`\``;
}

function buildWorkSceneSystemPrompt(maxScenes: number): string {
  return `# Team Work Method Memory Consolidation Architect

## 角色定义
你是团队工作方法记忆整合架构师。把碎片化的 L1 工作记忆整合成可复用的工作方法场景块。

## ⛔ 文件操作约束
同上：write/edit/read，删除用 [DELETED] 标记。

## ⚠️ 场景文件数量上限：${maxScenes} 个

## 工作流
### 阶段 0：检查场景总数（同上分级预警）
### 阶段 1：分析工作记忆，判断可复用方法
### 阶段 2：检索与策略选择（UPDATE > MERGE > CREATE）
### 阶段 3：撰写与合成
核心输出是可复用的工作方法：
- SOP：流程步骤、执行顺序、协作方式
- 判断逻辑：决策标准、优先级规则
- 禁忌：反模式、边界条件、失败模式
- 原则：长期遵守的约束和标准
- 经验：可跨任务复用的方法

## 输出模板
\`\`\`markdown
-----META-START-----
created: {{TIME}}
updated: {{CURRENT_TIME}}
summary: [summary]
heat: [Integer]
-----META-END-----

## 工作场景
## 适用条件
## 核心 SOP
## 判断逻辑
## 禁忌与反模式
## 关键事实依据
## 相关任务与资产
## 演化记录
## 待确认问题
\`\`\``;
}

function getSceneSystemPrompt(maxScenes: number, promptMode: MemoryPromptMode = 'chat'): string {
  return promptMode === 'code' ? buildWorkSceneSystemPrompt(maxScenes) : buildSceneSystemPrompt(maxScenes);
}

export function buildSceneExtractionPrompt(params: SceneExtractionPromptParams): SceneExtractionPromptResult {
  const {
    memoriesJson,
    sceneSummaries,
    currentTimestamp,
    sceneCountWarning,
    existingSceneFiles,
    maxScenes,
    promptMode = 'chat',
  } = params;

  const warningSection = sceneCountWarning
    ? `\n⚠️ **场景数量警告**: ${sceneCountWarning}\n`
    : '';

  const fileListSection = existingSceneFiles && existingSceneFiles.length > 0
    ? `### 已有场景文件清单（仅以下文件可 read）\n${existingSceneFiles.map((f) => `- \`${f}\``).join('\n')}\n`
    : `### 已有场景文件清单\n（当前无已有场景文件）\n`;

  const userPrompt = `**输出语言**：场景文件内容使用下方 New Memories List 中记忆的主导语言。
${warningSection}
### New Memories List
${memoriesJson}

### Existing Scene Blocks Summary
${sceneSummaries}

### Current Timestamp
${currentTimestamp}

${fileListSection}`;

  return {
    systemPrompt: getSceneSystemPrompt(maxScenes, promptMode),
    userPrompt,
  };
}
