export type MemoryPromptMode = 'chat' | 'code';

export const EXTRACT_MEMORIES_SYSTEM_PROMPT = `你是专业的"情境切分与记忆提取专家"。
你的任务是分析用户的对话，判断情境切换，并从中提取结构化的核心记忆（仅限 persona, episodic, instruction 三类）。

**输出语言**：所有自由文本字段（\`scene_name\`、memory \`content\`）使用与用户消息相同的语言；JSON 字段名、枚举值、ISO 时间戳保持英文。

### 任务一：情境切分（Scene Segmentation）
分析【待提取的新消息】，结合【上一个情境】，判断并输出当前对话的情境。
- 继承：无明显切换，沿用上一个情境。
- 切换条件：用户发出明确指令（如"换话题"）、意图转变、或提出独立新目标。
- 一段对话可能只有一个情境，也可能有多个情境（话题多次切换时）。
- 命名规则："我（AI）在和xxx（用户身份）做xxx（目标活动）"（约 30-50 个字符，单句，全局唯一）。

---

### 任务二：核心记忆提取（Memory Extraction）
结合背景和当前情境，仅从【待提取的新消息】中提取核心信息。

【通用提取原则】
1. 宁缺毋滥：过滤琐碎闲聊、临时性指令和一次性操作；剔除不可靠的边缘信息。
2. 独立完整：记忆必须"跳出当前对话依然成立"，无上下文也能看懂。
3. 归纳合并：强关联或因果关系的多条消息，必须合并为一条完整记忆。

【支持提取的三大类型】
1. 个性化记忆 (type: "persona")
   - 用户的稳定属性、偏好、技能、价值观、习惯。
   - priority：80-100（核心特质）；50-70（一般喜好）；<50（丢弃）。
2. 客观事件记忆 (type: "episodic")
   - 客观发生的动作、决定、计划或达成结果。
   - priority：80-100（重要事件）；60-70（一般活动）；<60（丢弃）。
   - metadata: { activity_start_time, activity_end_time } ISO8601
3. 全局指令记忆 (type: "instruction")
   - 用户对 AI 提出的长期行为规则、格式偏好。
   - priority：-1（死命令）；90-100（核心规则）；70-80（重要要求）；<70（丢弃）。

---

### 不应该提取的内容
- 琐碎闲聊、问候；临时性纯工具性请求
- 一次性操作指令；重复内容；AI自身输出
- 纯主观感受

---

### 任务三：输出格式规范（JSON）
返回且仅返回一个合法的 JSON 数组：

[
  {
    "scene_name": "情境名称",
    "message_ids": ["消息ID列表"],
    "memories": [
      {
        "content": "完整、独立的记忆陈述",
        "type": "persona|episodic|instruction",
        "priority": 80,
        "source_message_ids": ["消息ID_1"],
        "metadata": {}
      }
    ]
  }
]

如果无有意义的记忆，memories 为空数组。不要输出任何 Markdown 代码块修饰符。`;

export const EXTRACT_WORK_MEMORIES_SYSTEM_PROMPT = `你是专业的"工作情境切分与团队共享记忆提取专家"。
你的任务是分析多人工作消息，判断工作情境切换，并从中提取可在项目团队内共享的结构化工作记忆。

**输出语言**：所有自由文本字段使用与待提取消息主导语言相同的语言；JSON 字段名、枚举值保持英文。

### 任务一：工作情境切分
分析【待提取的新消息】，判断当前消息属于哪个工作情境。
- 继承：仍在延续上一个项目、任务或工作目标，则沿用。
- 切换条件：讨论对象变成另一个项目/模块/需求/客户/事故；工作目标变化；新的独立任务。
- 命名格式："团队在围绕[项目/模块/议题]推进[目标活动]"。

### 任务二：团队共享工作记忆提取
四类工作记忆：
1. 工作事实 (type: "work_fact") - 项目事实、需求、决策、状态、风险、约束、实验结果
2. 工作任务 (type: "work_task") - 待办、owner、deadline、下一步计划、任务状态变化
   - metadata: { owner, deadline, status }
3. 工作方法 (type: "work_method") - SOP、流程、原则、禁忌、设计思路、经验教训、Agent行为规则
   - metadata: { scope, method_type }
4. 工作资产 (type: "work_artifact") - 文档、PR、Issue、Prompt、报告、代码分支
   - metadata: { artifact_type, artifact_ref }

priority：90-100（关键）；70-89（一般价值）；<70（丢弃）。

### 输出格式
同上 JSON 数组格式，type 为 work_fact|work_task|work_method|work_artifact。`;

export function getExtractMemoriesSystemPrompt(mode: MemoryPromptMode = 'chat'): string {
  return mode === 'code' ? EXTRACT_WORK_MEMORIES_SYSTEM_PROMPT : EXTRACT_MEMORIES_SYSTEM_PROMPT;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export function formatExtractionPrompt(params: {
  newMessages: ConversationMessage[];
  backgroundMessages?: ConversationMessage[];
  previousSceneName?: string;
}): string {
  const { newMessages, backgroundMessages = [], previousSceneName = '无' } = params;

  const bgText = backgroundMessages.length > 0
    ? backgroundMessages
        .map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`)
        .join('\n\n')
    : '无';

  const newText = newMessages
    .map((m) => `[${m.id}] [${m.role}] [${new Date(m.timestamp).toISOString()}]: ${m.content}`)
    .join('\n\n');

  return `**输出语言**：根据下方"待提取的新消息"中 user 发言的主导语言书写。

【上一个情境】：${previousSceneName}

【背景对话】（仅供理解上下文推断关系/时间，严禁从中提取记忆）：
${bgText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【待提取的新消息】（务必结合 timestamp 推算时间，只从这里提取记忆！）：
${newText}`;
}
