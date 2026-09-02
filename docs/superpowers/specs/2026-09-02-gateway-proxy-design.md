# Gateway Proxy — Design Spec

> **Date**: 2026-09-02
> **Status**: Approved (pending implementation plan)
> **Author**: Design session with user

## 1. Overview

Gateway Proxy is a single-machine HTTP server that acts as an API Gateway for multiple AI coding agent processes (Codex, Claude Code, OpenCode, Hermes, etc.). It intercepts LLM requests to inject tools and intercepts LLM responses to extract shared memory. Agents call the proxy's HTTP endpoints (via curl) for memory queries, cross-agent messaging, and task callbacks. An IM sidecar provides a "command center" for the user to observe all agent activity and steer agents remotely from a phone.

### 1.1 Goals

- **Shared memory**: 4-layer extraction pipeline (JSONL → SQLite → Markdown) giving all agents a common knowledge base.
- **Cross-agent communication**: Redis Streams message bus for inter-process messaging and task callbacks.
- **Auto tool injection**: Proxy injects tool definitions into LLM requests (suffix-only, prefix-cache-aware).
- **IM command center**: User monitors all agent activity and sends steering commands via IM (企业微信/飞书).
- **Multi-protocol**: Pluggable adapters for OpenAI, Anthropic, and future LLM API protocols.

### 1.2 Non-goals (this phase)

- Multi-machine distributed deployment (single machine, multiple processes only).
- Four-layer memory extraction details (separate spec to follow).
- IM platform-specific implementations (企业微信/飞书 adapters are future work; interface only this phase).

## 2. Architecture

### 2.1 High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          单机环境 (Single Machine)                    │
│                                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  Codex   │  │Claude Code│  │ OpenCode │  │  Hermes  │               │
│  │  Agent   │  │  Agent    │  │  Agent   │  │  Agent   │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       └──────────────┴──────────────┴──────────────┘                    │
│                              │                                         │
│              ① LLM 请求 (base URL → proxy)                             │
│              ② 工具调用 (curl /gateway/tools/*)                         │
│                              ▼                                         │
│         ┌────────────────────────────────────────┐                    │
│         │         Gateway Proxy (:9800)           │                    │
│         │                                        │                    │
│         │  ┌─────────┐  ┌─────────┐  ┌────────┐ │                    │
│         │  │LLM Proxy│  │Tool API │  │MQ Bridge│ │                    │
│         │  │ /v1/*   │  │/gateway │  │(Redis   │ │                    │
│         │  │         │  │/tools/* │  │ Streams)│ │                    │
│         │  └────┬────┘  └────┬────┘  └───┬────┘ │                    │
│         │       ▼            ▼            ▼      │                    │
│         │  ┌──────────────────────────────────┐  │                    │
│         │  │     Memory Store                 │  │                    │
│         │  │  JSONL + SQLite + Markdown       │  │                    │
│         │  └──────────────────────────────────┘  │                    │
│         │  ┌──────────────────────────────────┐  │                    │
│         │  │      Event Bus (内部)             │  │                    │
│         │  └──────────────┬───────────────────┘  │                    │
│         └─────────────────┼──────────────────────┘                    │
│                           │                                           │
│         ┌─────────────────┼──────────────────────┐                    │
│         │    IM Sidecar (指挥中心旁路)              │                    │
│         │    ┌────────────▼──────────────┐        │                    │
│         │    │  IM Adapter (抽象接口)      │        │                    │
│         │    │  Outbound: 全量事件推送     │        │                    │
│         │    │  Inbound:  领导指令接收     │        │                    │
│         │    └────────────┬──────────────┘        │                    │
│         └─────────────────┼───────────────────────┘                    │
└─────────────────────────────┼──────────────────────────────────────────┘
                              │
                     ┌────────┴────────┐
                     │    手机 IM        │
                     │  企业微信/飞书    │
                     └─────────────────┘
```

### 2.2 Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | API Gateway (base URL rewrite) | No SSL cert management; agents only change base URL; single port |
| Tech stack | Node.js + TypeScript | Rich ecosystem, fast development, agent toolchain affinity |
| Agent integration | API-level interception (request/response modification at gateway) | Needed to intercept LLM responses for memory extraction; not network-level MITM |
| Tool execution | Agent actively calls proxy via curl | Agent's tool-calling loop executes HTTP calls to proxy |
| MQ | Redis Streams | Lightweight, fast, sufficient for direct agent-to-agent messaging |
| Deployment | Single machine, multiple processes | Simplicity; multi-machine is future work |
| Injection strategy | Suffix-only (prefix-cache-aware) | Preserves LLM provider prefix caching; never modifies request prefix |

## 3. Core Components

### 3.1 HTTP Server (Entry Layer)

Single HTTP server on port 9800 with path-based routing:

| Path | Layer | Purpose |
|---|---|---|
| `/v1/*` | LLM Proxy | Protocol-adapted LLM request interception and forwarding |
| `/gateway/tools/*` | Tool API | Agent curl-callable tool endpoints |
| `/gateway/agents/*` | Agent Management | Register, list, status |
| `/gateway/events/*` | Event Stream | SSE/WebSocket for real-time event subscription (optional) |

Agents identify themselves via `X-Agent-Id` header on every request.

### 3.2 Protocol Adapters

Pluggable adapters for different LLM API protocols:

```typescript
interface ProtocolAdapter {
  // Identify if this adapter handles the request
  match(path: string, headers: Headers): boolean;
  // Inject tool definitions into request body (suffix-only)
  injectTools(requestBody: any, tools: ToolDef[]): any;
  // Extract conversation data from response (for memory extraction)
  extractConversation(responseBody: any): ConversationData;
  // Forward request to real LLM API
  forwardRequest(requestBody: any, targetConfig: LLMConfig): Promise<Response>;
}
```

Built-in adapters:
- **OpenAI Adapter**: `/v1/chat/completions`, function calling format
- **Anthropic Adapter**: `/v1/messages`, tool_use format

### 3.3 Tool Injection Engine (Prefix-Cache-Aware)

**Core principle**: All injections are **suffix appends**. The proxy never modifies the prefix portion of any request.

#### System Prompt Injection (Suffix)

```
Original: "你是一个编码助手..."
Injected: "你是一个编码助手...\n\n## Gateway Tools\n你可以通过以下工具访问共享记忆和跨agent通信..."
```

The original system prompt remains unchanged as the prefix; gateway instructions are appended at the end.

#### Tool List Injection (Suffix)

```
tools: [
  { function: { name: "read_file", ... } },           // original (prefix, unchanged)
  { function: { name: "write_file", ... } },          // original (prefix, unchanged)
  ──── prefix cache boundary ────
  { function: { name: "gateway_search_memory", ... } }, // SUFFIX injected
  { function: { name: "gateway_send_message", ... } },   // SUFFIX injected
]
```

#### Injection Point Mechanism (Extensible)

```typescript
interface InjectionPoint {
  name: string;
  // Suffix-only injection; never modify prefix
  apply(requestBody: any, ctx: InjectionContext): any;
}

// Built-in
SystemPromptSuffixInjector   // Appends gateway instructions to system prompt end
ToolListSuffixInjector        // Appends gateway tools to tools array end

// Future extensions (metrics panel)
// CacheMetricsInjector      // Inject cache hit rate stats
// MemoryStatsInjector       // Inject memory call counts
```

Each injection point can be toggled independently and configured per agent type.

#### Built-in Injected Tools

| Tool Name | Endpoint | Purpose |
|---|---|---|
| `gateway_search_memory` | `POST /gateway/tools/search_memory` | Query shared memory across all agents |
| `gateway_send_message` | `POST /gateway/tools/send_message` | Send message to another agent via MQ |
| `gateway_check_inbox` | `GET /gateway/tools/inbox` | Read incoming messages from MQ |
| `gateway_register_callback` | `POST /gateway/tools/register_callback` | Register task completion callback |
| `gateway_get_agents` | `GET /gateway/tools/agents` | List online agents |

Tool definitions include curl instructions in their descriptions so the agent's tool-calling loop knows how to execute them via HTTP.

### 3.4 Memory Store

Three storage backends supporting a 4-layer extraction pipeline:

```
data/
├── messages/              # Layer 0: JSONL raw messages
│   ├── agent_codex.jsonl
│   ├── agent_claude.jsonl
│   └── ...
├── memory.db              # Layer 1-2: SQLite (vector + structured)
│   ├── tables: facts, summaries, entities, relations
│   └── vec tables: embeddings (sqlite-vec)
├── skills/                # Layer 3: Markdown skills
│   ├── code-review.md
│   ├── debug-pattern.md
│   └── ...
└── personality/           # Layer 4: Personality & preferences
    ├── codex-profile.md
    ├── claude-profile.md
    └── ...
```

#### Four-Layer Extraction Pipeline

```
LLM Response
  → [JSONL Store]              Layer 0: Raw message persistence
  → [Layer 1: Structured extraction → SQLite (non-vector tables)]
  → [Layer 2: Vector embedding → SQLite (sqlite-vec tables)]
  → [Layer 3: Skill extraction → Markdown files]
  → [Layer 4: Personality/preference extraction → Markdown files]
```

Extraction is **asynchronous**: the LLM response is returned to the agent immediately, while memory extraction runs in the background. The extraction pipeline details (what each layer extracts, embedding model, extraction prompts) will be specified in a separate memory design spec.

#### Unified Query Interface

```typescript
interface MemoryQuery {
  query: string;
  layer?: 'raw' | 'structured' | 'skill' | 'personality' | 'all';
  agentFilter?: string;
  limit?: number;
}
```

### 3.5 Message Queue Bridge (Redis Streams)

#### Stream Architecture

| Stream | Purpose |
|---|---|
| `agent:{id}:inbox` | Each agent's inbox (messages sent to this agent) |
| `agent:{id}:outbox` | Each agent's outbox (for audit, optional) |
| `events:all` | Global event stream (consumed by IM sidecar) |

#### Message Format

```json
{
  "id": "msg_xxx",
  "from": "agent_codex",
  "to": "agent_claude",
  "type": "task | callback | chat | command",
  "body": "...",
  "reply_to": "msg_yyy",
  "timestamp": 1690000000
}
```

#### Message Flow

- **Send**: `POST /gateway/tools/send_message` → proxy writes to target agent's inbox stream
- **Receive**: `GET /gateway/tools/inbox` → proxy reads from calling agent's inbox stream
- **Task callback**: Agent A sends (type=task) to Agent B → B completes → B sends (type=callback, reply_to=original msg id) back to A

### 3.6 Event Bus & IM Sidecar (Command Center)

#### Event Bus (Internal)

```typescript
// Event types
type EventType =
  | 'agent.registered' | 'agent.unregistered'
  | 'llm.request' | 'llm.response'
  | 'tool.call' | 'tool.result'
  | 'mq.message.sent' | 'mq.message.received'
  | 'task.callback' | 'memory.extracted'
  | 'error' | 'warning';
```

All agent activity generates events on the internal event bus.

#### IM Sidecar

**Outbound (Proxy → IM)**: Event Bus events are formatted and pushed to IM. The user sees:
- Agent start/stop
- LLM request/response summaries
- Tool calls and results
- Agent-to-agent messages
- Task completion callbacks
- Memory extraction summaries
- Errors and warnings

**Inbound (IM → Proxy)**: The user sends commands from IM:
```
"@claude-code 重构auth模块"     → steering message to claude-code agent
"status"                        → all agent status report
"memory query 认证逻辑"         → query memory, return results to IM
"stop codex"                    → stop codex agent
```

#### IM Adapter Interface

```typescript
interface IMAdapter {
  // Send a message/notification to IM
  send(message: string, opts?: IMMessageOptions): Promise<void>;
  // Register handler for inbound messages from IM
  onMessage(handler: (msg: IMInboundMessage) => void): void;
  // Start/stop the adapter
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

Future implementations: `WeComAdapter` (企业微信), `FeishuAdapter` (飞书).

## 4. Data Flow

### 4.1 Agent Startup Registration

```
Agent starts → POST /gateway/agents/register {name, type, llm_config}
             → Proxy assigns agent_id, creates inbox/outbox Redis Streams
             → EventBus: agent.registered → IM push "Codex已上线"
```

### 4.2 LLM Request (Tool Injection)

```
Agent → POST /v1/chat/completions (headers: X-Agent-Id, body: original request)
     → ProtocolAdapter.match() → select OpenAI Adapter
     → InjectionEngine.apply() → suffix-append tools + system prompt
     → Adapter.forwardRequest() → forward to real LLM API
     → EventBus: llm.request → IM push (request summary)
```

### 4.3 LLM Response (Memory Extraction)

```
LLM API → Response (contains conversation content)
       → Adapter.extractConversation() → extract conversation data
       → Async: JSONL store → 4-layer extraction pipeline (background)
       → Sync: return response to Agent
       → EventBus: llm.response + memory.extracted → IM push
```

### 4.4 Agent Tool Call (curl)

```
Agent (LLM returned tool_call) → curl POST /gateway/tools/search_memory
                              → Proxy executes query
                              → EventBus: tool.call + tool.result → IM push
                              → return result to Agent
```

### 4.5 Cross-Agent Communication

```
Agent A → curl POST /gateway/tools/send_message {to: "agentB", body: "..."}
       → Proxy writes to Redis Stream agent:agentB:inbox
       → EventBus: mq.message.sent → IM push "A→B: ..."
       → Agent B → curl GET /gateway/tools/inbox → reads message
       → EventBus: mq.message.received → IM push "B received from A"
```

### 4.6 Task Completion Callback

```
Agent A → send_message(type: task, to: B, body: "重构auth模块")
Agent B → (completes task) → send_message(type: callback, reply_to: original_id, to: A, body: "已完成")
Agent A → check_inbox → receives callback
```

### 4.7 IM Steering (Leader Intervention)

```
Phone IM → "claude-code: 改用JWT方案" → IMAdapter.onMessage()
         → commandParser.parse() → identify target agent
         → write to agent:claude-code:inbox (type: command)
         → IM reply: "已发送给 claude-code"
         → Claude Code checks inbox next cycle → receives steering command
```

## 5. Project Structure

```
gateway-proxy/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts                    # Entry point: start HTTP server
│   ├── config/
│   │   └── index.ts                # Config loader (port, LLM endpoints, Redis, etc.)
│   ├── server/
│   │   ├── httpServer.ts           # HTTP server (route registration)
│   │   └── router.ts               # Route dispatcher (/v1/* vs /gateway/*)
│   ├── proxy/
│   │   ├── llmProxyHandler.ts      # LLM request interception + forwarding core
│   │   └── protocolAdapters/
│   │       ├── types.ts            # ProtocolAdapter interface
│   │       ├── openaiAdapter.ts    # OpenAI protocol adapter
│   │       └── anthropicAdapter.ts # Anthropic protocol adapter
│   ├── injection/
│   │   ├── types.ts                # InjectionPoint interface
│   │   ├── injectionEngine.ts      # Injection engine (manages injection point chain)
│   │   ├── systemPromptInjector.ts # System prompt suffix injection
│   │   └── toolListInjector.ts     # Tool list suffix injection
│   ├── tools/
│   │   ├── toolRegistry.ts         # Tool definition registry
│   │   ├── toolHandlers.ts         # Tool execution handlers
│   │   └── definitions/            # Tool definitions (extensible)
│   │       ├── searchMemory.ts
│   │       ├── sendMessage.ts
│   │       ├── checkInbox.ts
│   │       └── ...
│   ├── memory/
│   │   ├── types.ts                # Memory system interfaces
│   │   ├── jsonlStore.ts           # Layer 0: JSONL storage
│   │   ├── sqliteStore.ts          # Layer 1-2: SQLite (vector + structured)
│   │   ├── markdownStore.ts        # Layer 3-4: Markdown (skill + personality)
│   │   ├── extraction/
│   │   │   ├── pipeline.ts         # 4-layer extraction pipeline
│   │   │   ├── layer1_structured.ts
│   │   │   ├── layer2_vector.ts
│   │   │   ├── layer3_skill.ts
│   │   │   └── layer4_personality.ts
│   │   └── query.ts                # Unified query interface
│   ├── mq/
│   │   ├── redisStream.ts          # Redis Streams wrapper
│   │   ├── messageBus.ts           # Message routing (inbox/outbox)
│   │   └── types.ts
│   ├── events/
│   │   ├── eventBus.ts             # Internal event bus
│   │   └── types.ts                # Event type definitions
│   ├── im/
│   │   ├── types.ts                # IMAdapter interface
│   │   ├── imSidecar.ts            # IM sidecar (outbound + inbound)
│   │   ├── adapters/
│   │   │   ├── wecomAdapter.ts     # 企业微信 (future)
│   │   │   └── feishuAdapter.ts    # 飞书 (future)
│   │   └── commandParser.ts        # IM command parser
│   └── agents/
│       ├── agentRegistry.ts        # Agent registration + status management
│       └── types.ts
├── data/                            # Runtime data (gitignored)
│   ├── messages/                    # JSONL
│   ├── memory.db                    # SQLite
│   ├── skills/                      # Markdown
│   └── personality/                 # Markdown
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-09-02-gateway-proxy-design.md
└── tests/
```

## 6. Configuration

### 6.1 Environment Variables (.env)

```env
# Server
GATEWAY_PORT=9800
GATEWAY_HOST=127.0.0.1

# Redis
REDIS_URL=redis://127.0.0.1:6379

# LLM API endpoints (real targets)
OPENAI_API_BASE=https://api.openai.com
ANTHROPIC_API_BASE=https://api.anthropic.com

# Memory
SQLITE_DB_PATH=./data/memory.db
JSONL_DIR=./data/messages
SKILLS_DIR=./data/skills
PERSONALITY_DIR=./data/personality

# IM (future)
IM_ADAPTER=wecom  # wecom | feishu
WECOM_WEBHOOK_URL=
WECOM_API_KEY=
FEISHU_APP_ID=
FEISHU_APP_SECRET=

# Logging
LOG_LEVEL=info
```

### 6.2 Agent Configuration

Agents need two configuration changes to use the proxy:
1. **LLM API base URL**: Change to `http://127.0.0.1:9800/v1` (instead of `https://api.openai.com/v1`)
2. **X-Agent-Id header**: Set in LLM API requests (or configured at registration)

## 7. Error Handling

- **LLM API errors**: Proxy forwards error responses to agent; EventBus emits `error` event → IM push
- **MQ errors**: Redis connection loss → proxy returns 503 for tool calls that require MQ; agents can retry
- **Memory extraction errors**: Background extraction failures do not block agent responses; logged and pushed to IM as `warning`
- **IM adapter errors**: Outbound push failures are logged but do not affect proxy operation; inbound listener auto-reconnects

## 8. Testing Strategy

- **Unit tests**: Each component (adapters, injectors, stores, MQ wrapper) tested in isolation with mocks
- **Integration tests**: Full request flow from agent → proxy → LLM (mocked) → agent, with tool injection and memory extraction
- **MQ tests**: Redis Streams messaging with real Redis instance (or embedded)
- **IM sidecar tests**: Mock IMAdapter, verify event routing and command parsing

## 9. Future Extensions

1. **Four-layer memory extraction details**: Separate spec for extraction prompts, embedding model, entity/relation schemas
2. **IM platform adapters**: 企业微信 and 飞书 implementations
3. **Metrics panel**: Cache hit rate, memory call counts, agent activity dashboard
4. **Multi-machine**: Distributed deployment with networked Redis and proxy federation
5. **Additional protocol adapters**: Local model APIs (Ollama, vLLM), other LLM providers
6. **Injection point marketplace**: Custom injectors as plugins (cache metrics, memory stats, etc.)
