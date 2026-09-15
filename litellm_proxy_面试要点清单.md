# LiteLLM Proxy 面试要点清单（10 题回答框架 + 代码佐证）

> 本文档针对 10 个高频面试提问，每题给出 **回答框架 + 关键代码位置 + 话术要点**。
> 配套阅读：同目录 `litellm_proxy_面试拷问版.md`（深度 Q&A）、`litellm_proxy_性能优化复盘.md`（性能案例）、`litellm_proxy_述职学习指南.md`（系统总览）。

---

## Q1：鉴权链路原来 4308ms 的瓶颈在哪？你是怎么定位的？

### 回答框架

1. **先说结论**：4308ms 不正常，健康鉴权应是毫秒级。瓶颈不是"稳定慢"，而是三个病根叠加：
   - `team_member_add` 同步阻塞写（4~20s）在鉴权关键路径上
   - DB 抖动触发误判雪崩（偶发 294s 尖刺拉高平均值）
   - 串行 DB 查询 + 缓存键分裂导致每 5s 必穿透
2. **定位方法**：不是估的，是埋点测的。用 `_timed_auth_db_step` 上下文管理器把每个鉴权 DB 步骤的耗时记录到 `request.state.auth_db_step_timings`，再写入 metadata → spend logs
3. **关键发现**：看到 `teammembership_db` 步骤耗时异常尖刺，且尖刺与 DB 抖动时间吻合 → 意识到不是"稳定慢"而是"偶发尖刺拉高平均值"

### 代码佐证

| 要点 | 文件 | 行号 / commit |
|---|---|---|
| 埋点上下文管理器 | `litellm/proxy/litellm_pre_call_utils.py` | commit `d53d288e0c` |
| 耗时写入 metadata | `litellm/proxy/litellm_pre_call_utils.py` | `data[metadata]["auth_db_step_timings"]` |
| 耗时落到 spend logs | `litellm/proxy/spend_tracking/spend_tracking_utils.py` | `clean_metadata["auth_db_step_timings"]` |
| 雪崩注释 | `litellm/proxy/auth/user_api_key_auth.py` | commit `689775c7e4` |
| 294s 实测数据 | `litellm/proxy/auth/user_api_key_auth.py` | commit `c4c83685c7` 注释 |

### 话术

> "4308ms 是埋点测出来的，不是估的。我加了 `_timed_auth_db_step` 把每个 DB 步骤包起来记录耗时。看到 `teammembership_db` 有异常尖刺，和 DB 抖动时间吻合，才知道不是'稳定慢'而是'偶发尖刺拉高平均值'。根因是 DB 抖动时误判用户不在 team，触发 4~20s 的写操作，写操作又超时再误判，形成雪崩。"

---

## Q2："高耗时写操作移出关键路径"具体指什么操作？移到哪里了？异步写会不会有一致性问题？

### 回答框架

1. **具体操作**：`team_member_add` — JWT 用户首次访问 Team 时，需要多表写（usertable 写 + budgettable 写 + teammembership 写），单次 4~20s
2. **移到哪里**：改成 `asyncio.create_task` fire-and-forget 后台任务，鉴权立即返回不等它
3. **一致性分析**：
   - 这个操作失败**不影响本次请求的正确性** — team/user 级限额依然生效
   - 属于可接受的 fail-open：失败了只是"这次没自动加入 team"，下次再触发
   - 如果换成扣费操作，**绝不能** fire-and-forget
4. **两个技术细节**：必须持有强引用防 GC（`_background_tasks` set）；必须在 `done_callback` 里消费异常防 "Task exception was never retrieved"

### 代码佐证

| 要点 | 文件 | 行号 / commit |
|---|---|---|
| 后台任务创建 | `litellm/proxy/auth/user_api_key_auth.py` | commit `c4c83685c7` |
| 强引用 set | 同上 | `_background_tasks.add(_bg_task)` |
| 异常消费 | 同上 | `_bg_task.add_done_callback(_discard_background_task)` |
| JWT 路径同样改造 | `litellm/proxy/auth/handle_jwt.py` | commit `88a5fa1403` |
| 标记缓存防重复触发 | `litellm/proxy/auth/handle_jwt.py` | commit `88a5fa1403`，`_added_marker_key` |

### 话术

> "`team_member_add` 是多表写操作，4~20s，原来在鉴权路径同步 await。改成 `asyncio.create_task` 后台任务后，鉴权只做读，不等写完成。一致性上，这个操作失败不影响本次请求 — team/user 级限额照常生效。但如果换成扣费，绝不能 fire-and-forget。异步有两个坑：必须持有强引用防 GC，必须消费异常防 'never retrieved'。"

---

## Q3：asyncio 并行查询具体并行了哪些查询？如果某个查询失败了怎么处理？

### 回答框架

1. **并行了哪些查询**：
   - JWT 路径（`handle_jwt.py`）：`get_org_object`、`get_end_user_object`、`get_team_membership` 三个独立查询
   - 集中校验（`auth_checks.py`）：team、user、project、end_user、global_spend 五个查询
2. **失败处理**：`asyncio.gather(*fetch_coros, return_exceptions=True)` + 逐个检查结果是值还是异常
3. **为什么不能用裸 except**：如果用一个 `except` 包住整个 `gather`，`get_team_object` 抛出的 404 会让 user、end_user、project、global_spend 的检查**全部被跳过** — 这是严重的权限漏洞
4. **不能并行的场景**：有依赖关系的查询不能并行，比如 `get_user_object` 的结果可能被后面的 upsert 用到

### 代码佐证

| 要点 | 文件 | 行号 / commit |
|---|---|---|
| JWT 并行化 | `litellm/proxy/auth/handle_jwt.py` | commit `88a5fa1403` |
| common_checks 并行 | `litellm/proxy/auth/auth_checks.py` | commit `5ab4442634`，`_safe_fetch` wrapper |
| `return_exceptions=True` | `litellm/proxy/auth/auth_checks.py` | `asyncio.gather(*fetch_coros, return_exceptions=True)` |
| 逐个检查结果 | 同上 | 逐个判断 `isinstance(result, Exception)` |

### 话术

> "并行了 JWT 路径的 org/end_user/team_membership 三个独立查询，以及集中校验的 team/user/project/end_user/global_spend 五个查询。失败处理用 `return_exceptions=True`，一个查询失败不会拖垮其他查询。如果用裸 except 包住整个 gather，一个 404 会让所有检查被跳过 — 权限漏洞。有依赖关系的查询不能并行，比如 user 查询的结果被后续 upsert 用到。"

---

## Q4：L1 + Redis 多级缓存的一致性如何保证？缓存键统一方案是什么？怎么消除冗余查询？

### 回答框架

1. **多级缓存结构**：L1 InMemoryCache（LRU，max_size=100）→ L2 Redis → DB，逐级回填
2. **一致性问题与解法**：
   - `team_metadata` 同步：key 缓存后 team 新增的 guardrails/metadata 要能被后续请求看到 → 每次请求用 fresh team 同步 `valid_token.team_metadata`
   - TTL 按数据变更频率分类：变更快的（新 key）不缓存；变更慢的（model 配置、team 映射）长 TTL（1800s~3600s）
   - 负向缓存的坑：新 key 30s 内无法鉴权 → 去掉了 key 的负向缓存，但 model 信息的 NULL sentinel 保留（TTL=300s）
3. **缓存键统一**：team_membership 原来两套键互不可见（`{team_id}_{user_id}` TTL=5s vs `team_membership:{u}:{t}` TTL=1800s）→ 统一用 `get_team_membership` 函数，共用键 + TTL=1800s + `find_unique`（唯一复合索引）
4. **消除冗余查询**：pre-fetched 对象透传 — `_user_api_key_auth_builder` 已查过的对象挂在 token 上传给 `common_checks`，避免重复查

### 代码佐证

| 要点 | 文件 | 行号 / commit |
|---|---|---|
| DualCache 实现 | `litellm/caching/dual_cache.py` | L1 InMemoryCache → L2 Redis |
| 缓存键统一 | `litellm/proxy/auth/auth_checks.py` | commit `5ab4442634`，"瓶颈4修复" |
| NULL sentinel | `litellm/proxy/auth/auth_checks.py` | commit `5ab4442634`，"瓶颈5修复" |
| 去除负向缓存 | `litellm/proxy/auth/user_api_key_auth.py` | commit `3f75a8977d` |
| pre-fetched 透传 | `litellm/proxy/auth/auth_checks.py` | commit `5ab4442634`，`_pre_fetched_end_user_obj` |
| JWT 放开强制查 DB | `litellm/proxy/auth/handle_jwt.py` | commit `8179a0dc27`，`check_db_only=False` |
| 延长 TTL | `litellm/proxy/auth/handle_jwt.py` | commit `8179a0dc27`，`_TEAM_KEY_NAME_CACHE_TTL=1800` |

### 话术

> "L1 内存 + L2 Redis + DB 逐级回填。一致性靠三点：team_metadata 每次请求用 fresh team 同步；TTL 按变更频率分类，新 key 不缓存、model 配置 1800s；负向缓存新 key 30s 失效所以去掉了。缓存键统一把两套互不可见的键合并成一个，消除了每 5s 的必然穿透。冗余查询通过 pre-fetched 对象透传消除，避免同一次请求重复查同一个对象。"

---

## Q5：User/Team/Scene/JWT 多维鉴权的模型设计？Token 校验流程？

### 回答框架

1. **数据模型**：Organization → Team ←→ TeamMembership ←→ User；凭证（VerificationToken）分三类：user-key（绑 user_id）、team-key（绑 team_id）、master-key（管理员）
2. **核心设计哲学**：解耦、收敛、单点强制
   - **多入口**：入口 A（标准 sk- key 或 JWT）+ 入口 B（JWT + team_alias + scene 混合鉴权）
   - **收敛**：无论哪种凭证，最终都解析为统一身份对象（User + Team + TeamMembership）
   - **单点强制**：所有路径收敛后，由一个统一的 `common_checks` 运行全部校验
3. **Token 校验流程（判定树）**：
   - `token == master_key` → PROXY_ADMIN
   - JWT（三段式）→ decode + JWKS 验签 → RBAC/scope → team 映射 → 取 team_key
   - `sk-` 且带 user_id → user-key 路径
   - `sk-` 且不带 user_id → team-key 路径
4. **Scene 是请求上下文**，不是身份维度 — 不改变"你是谁"，只改变"用什么模型/权限"
5. **JWT 映射 team_key 的原因**：JWT 负责认证（你是谁），team_key 负责授权和计费（绑定预算/权限），映射让两者解耦

### 代码佐证

| 要点 | 文件 | 行号 / commit |
|---|---|---|
| 鉴权入口 | `litellm/proxy/auth/user_api_key_auth.py` | `user_api_key_auth()` + `user_team_auth()` |
| 核心 builder | 同上 | `_user_api_key_auth_builder()` |
| JWT 处理 | `litellm/proxy/auth/handle_jwt.py` | JWT decode + JWKS + team 映射 |
| 集中校验 | `litellm/proxy/auth/auth_checks.py` | `common_checks()` |
| Scene 鉴权 | `litellm/proxy/auth/user_api_key_auth.py` | commit `4a182adab8` |
| JWT 分组 | `litellm/proxy/auth/handle_jwt.py` | commit `6224c009df` |
| 多 Team 分层限额 | `litellm/proxy/auth/auth_checks.py` | commit `a6b1117c9e` |

### 话术

> "数据模型是 User ←→ TeamMembership ←→ Team，凭证分 user-key/team-key/master-key 三类。设计哲学是解耦、收敛、单点强制：多入口收不同的凭证，收敛成统一身份对象，最后由 common_checks 单点强制所有校验。Scene 是上下文不是身份维度。JWT 负责认证，映射到 team_key 复用授权和计费体系，认证授权分离。"

---

## Q6：多级 Budget 管控：个人/Team Member/Team 的扣减顺序和并发安全怎么做的？

### 回答框架

1. **检查顺序**（在 `common_checks()` 中）：

| 顺序 | 预算类型 | Counter Key | 行为 |
|---|---|---|---|
| 1 | Team max budget | `spend:team:{team_id}` | HARD block |
| 2 | Team multi-window | `spend:team:{team_id}:window:{dur}` | HARD block |
| 3 | Virtual key multi-window | `spend:key:{token}:window:{dur}` | HARD block |
| 4 | Team soft budget | — | Alert only |
| 5 | Organization | `spend:org:{org_id}` | HARD block |
| 6 | Tag | `spend:tag:{tag_name}` | HARD block |
| 7 | **User personal** | `spend:user:{user_id}` | HARD block |
| 8 | **Team member** | `spend:team_member:{user_id}:{team_id}` | HARD block |
| 9 | End user | — | HARD block |
| 10 | Global proxy | — | HARD block |

   **关键**：个人预算（step 7）在 team member 预算（step 8）之前检查。分层预算是"任一触顶即拦截"。

2. **并发安全 — 四层机制**：
   - **Redis `INCRBYFLOAT`**：原子服务端操作，返回增量后的新值，立即判断是否超预算
   - **Redis `SET NX`**：冷启动 counter reseed 时用 `SET IF NOT EXISTS`，只有一个 Pod 赢，避免 N 个 Pod 各加一遍 db_spend 导致计数翻倍
   - **Per-counter `asyncio.Lock`**：单 Pod 内合并 DB reseed 请求（double-checked locking），但不跨 Pod
   - **Budget reservation + rollback**：预调用时原子增量所有 counter，任一超限则回滚之前已增量的 counter

3. **Budget Reset**：APScheduler 定时任务，reset 顺序 keys → users → teams → budget_table → windows。**counter 清零在 DB 写提交之后**，否则 DB 写失败时 Redis 已清零，形成绕过窗口。

### 代码佐证

| 要点 | 文件 | 行号 |
|---|---|---|
| 检查顺序 | `litellm/proxy/auth/auth_checks.py` | `common_checks()` lines 494-776 |
| Team budget check | 同上 | line 656, `_team_max_budget_check` |
| User budget check | 同上 | lines 704-721 |
| Team member budget check | 同上 | lines 724-732, `_check_team_member_budget` |
| Redis INCRBYFLOAT | `litellm/caching/redis_cache.py` | line 844, `incrbyfloat` |
| Counter increment | `litellm/proxy/proxy_server.py` | lines 2402-2423, `_increment_spend_counter_cache` |
| SET NX reseed | `litellm/proxy/db/spend_counter_reseed.py` | lines 188-199, `nx=True` |
| Per-counter Lock | 同上 | lines 46-62, `_get_lock` |
| Budget reservation | `litellm/proxy/spend_tracking/budget_reservation.py` | lines 104-160 |
| Budget reset job | `litellm/proxy/common_utils/reset_budget_job.py` | lines 29-53, `reset_budget()` |
| Counter 清零在 DB 后 | 同上 | lines 55-84, `_invalidate_spend_counter` |

### 话术

> "检查顺序是 Team → User personal → Team member，任一触顶即拦截。并发安全四层：Redis INCRBYFLOAT 原子增量；SET NX 防多 Pod 冷启动翻倍；per-counter asyncio.Lock 合并 Pod 内 reseed；budget reservation 做原子增量+回滚。Budget reset 的关键细节是 counter 清零必须在 DB 写提交之后，否则 Redis 已清零但 DB 还没改，形成绕过窗口。"

---

## Q7：模型输出质量治理：Thinking 循环重复检测算法是什么？乱码/异常字符怎么定义和检测？

### 回答框架

> **声明**：这是规划中的功能，尚未落地为 commit。下面是基于 LiteLLM 真实流式架构设计的可落地方案。

1. **Hook 点**：`async_post_call_streaming_iterator_hook`（`custom_logger.py:466`），在 `combined_generator` 透传给客户端**之前**执行
   - 为什么不是 per-chunk hook：重复检测需要跨 chunk 维护滑动窗口状态
   - 为什么不是 `async_log_success_event`：那是流结束后的日志回调，内容已透传，拦截不了

2. **三套检测算法**：
   - **(1) Thinking 重复检测（n-gram 循环）**：维护 reasoning_content 的滑动窗口（最近 2000 字符），每累积 K 个 chunk 计算窗口内 n-gram 重复率。重复率 = 1 - (unique n-gram 数 / 总 n-gram 数)，> 0.5 判定退化。辅助检测连续重复行/句（同一句子连续出现 ≥3 次）。n-gram 而非精确匹配因为模型循环往往是"近似重复"。
   - **(2) 乱码检测**：mojibake 字节模式（UTF-8 中文被按 Latin-1 解码产生 Ã/Â/å 等字符组合，正则匹配）；U+FFFD 替换字符占比超阈值；再编码探测（`encode('latin-1').decode('utf-8')` 成功且结果是合理中文 → 确认乱码）
   - **(3) 异常字符检测**：控制字符 U+0000–U+001F（排除 \n\t\r）、U+FFFD、零宽字符（U+200B–U+200F、U+FEFF）、私有区字符（U+E000–U+F8FF），占比 > 1% 判定异常

3. **流式约束**：有界滑动窗口 + 增量检测 + 摊销重检查
   - 窗口有界：内存 O(N) 恒定，不随响应增长
   - 轻量检查（异常字符）每 chunk 做
   - 重量检查（n-gram 重复率）每 K 个 chunk 才做一次

4. **拦截策略**：三级可配置
   - Level 1 observe：只统计不拦截，灰度期收集数据定阈值
   - Level 2 truncate：停止 yield 退化内容，emit 干净终止 chunk + [DONE]
   - Level 3 block：`raise StreamingCallbackError(message)`

5. **现有参照**：LiteLLM 已有 `raise_on_model_repetition`（`streaming_handler.py:261-297`）检测连续相同 chunk，超过 `REPEATED_STREAMING_CHUNK_LIMIT` 次 raise `InternalServerError` 触发 Router 重试

### 代码佐证

| 要点 | 文件 | 行号 |
|---|---|---|
| Iterator hook 定义 | `litellm/integrations/custom_logger.py` | line 466 |
| hook 调用链 | `litellm/proxy/utils.py` | line 2525 |
| StreamingCallbackError | `litellm/proxy/proxy_server.py` | line 3182 |
| 现有重复检测 | `litellm/litellm_core_utils/streaming_handler.py` | lines 261-297, `raise_on_model_repetition` |
| AIM guardrail 模板 | `litellm/proxy/guardrails/guardrail_hooks/aim/aim.py` | lines 302-339 |
| Delta 结构 | `litellm/types/utils.py` | line 1270, `delta.content` / `delta.reasoning_content` |
| Fast-path 检测 | `litellm/proxy/utils.py` | line 2544, 无 override 时 chunk 直接透传 |

### 话术

> "这是规划功能，尚未落地。Hook 点选 `async_post_call_streaming_iterator_hook`，因为重复检测需要跨 chunk 滑动窗口。三套算法：n-gram 重复率检测 thinking 循环、mojibake 字节模式 + U+FFFD 占比检测乱码、控制字符/零宽字符/私有区占比检测异常字符。流式约束用有界窗口 + 增量检测 + 摊销重检查。拦截三级：observe 只统计、truncate 截断、block 报错。LiteLLM 已有 `raise_on_model_repetition` 做简单重复检测，我的方案是它的增强版。"

---

## Q8：异常拦截后如何避免污染后续上下文？Tool 调用被中断后 Agent 怎么恢复？

### 回答框架

1. **避免上下文污染 — 多层防护**：

   - **SSE 错误不泄露 traceback**：`async_data_generator` 的 except 块注释明确："Only include the error message, not the traceback. Including it in the SSE response leaks internal details to clients." 只返回 `str(e)`，不返回 traceback
   - **失败只记录一次**：`_handle_failure` 用 `_failure_handled` 标志保证幂等，防止重复/部分日志记录污染 spend/usage tracking
   - **RESPONSE_FAILED 路由到 failure handler**：不是误记为成功，而是构造 `APIError` 走 `_handle_failure`，确保日志正确记录失败
   - **SSE output recovery**：`sse_output_recovery.py` 从原始 chunk 重建 output item，bad chunk 静默跳过（返回 None），不污染状态
   - **会话历史不写入失败 turn**：`_save_turn_history` 只在有 valid response ID 的 completed_event 时才存储，失败/部分 turn 不污染下一轮

2. **Tool 调用中断恢复**：
   - **MCP tool 异常不 raise，转为 tool_results**：`litellm_proxy_mcp_handler.py` 捕获四层异常（BlockedPiiEntityError → GuardrailRaisedException → HTTPException → Exception），每层都转成 `{"tool_call_id": ..., "result": error_message}` 放入 `tool_results`，**不中断对话**，后续 LLM 调用收到格式正确的 tool-result 消息
   - **tool_call_id 恢复**：`_recover_tool_call_id_from_assistant` 修复空的 `tool_call_id`，防止后续消息关联断裂
   - **MCP streaming iterator 错误降级**：tool 执行失败时 `self.tool_results = []` 重置，follow-up 路径优雅降级
   - **list_tools 失败仍发 output_item.done**：即使获取工具列表失败，也 emit 空工具列表的 done 事件，保持流格式合法

3. **MidStreamFallbackError — 流中断后 Router fallback**：
   - `CustomStreamWrapper._handle_stream_fallback_error` 捕获流中异常，区分非可重试 4xx（直接 raise）和可重试错误（包装为 `MidStreamFallbackError`）
   - Router 的 `stream_with_fallbacks` 捕获 `MidStreamFallbackError`，用 fallback 模型重试
   - **关键**：如果首 chunk 已发出（`is_pre_first_chunk=False`），注入 continuation prompt 让 fallback 模型续写而非重写；携带 `generated_content` 保留已生成内容

### 代码佐证

| 要点 | 文件 | 行号 |
|---|---|---|
| SSE 不泄露 traceback | `litellm/proxy/proxy_server.py` | lines 7036-7040 |
| 失败幂等 | `litellm/responses/streaming_iterator.py` | lines 568-599, `_handle_failure` |
| RESPONSE_FAILED 路由 | 同上 | lines 351-375, `_handle_logging_failed_response` |
| SSE output recovery | `litellm/responses/sse_output_recovery.py` | lines 18-44, `parse_sse_json_chunk` |
| 会话历史不写失败 turn | `litellm/responses/streaming_iterator.py` | lines 1727-1746, 1768-1770 |
| MCP tool 异常转 tool_results | `litellm/responses/mcp/litellm_proxy_mcp_handler.py` | lines 855-921 |
| tool_call_id 恢复 | `litellm/responses/litellm_completion_transformation/transformation.py` | lines 584-605 |
| MCP streaming 降级 | `litellm/responses/mcp/mcp_streaming_iterator.py` | lines 727-732 |
| list_tools 失败仍发 done | 同上 | lines 129-159 |
| MidStreamFallbackError | `litellm/litellm_core_utils/streaming_handler.py` | lines 2365-2438 |
| Router fallback | `litellm/router.py` | lines 2116-2258, `stream_with_fallbacks` |
| StreamingCallbackError | `litellm/proxy/proxy_server.py` | line 3182, 不 re-raise 而是转 SSE JSON |
| WS bidirectional cleanup | `litellm/responses/streaming_iterator.py` | lines 1375-1392 |
| Client disconnect spend flush | `litellm/passthrough/main.py` | line 446, GeneratorExit 时 flush |

### 话术

> "避免污染有四层：SSE 错误只返回 message 不返回 traceback；失败只记一次靠幂等标志；失败的 turn 不写入会话历史；SSE output recovery 对 bad chunk 静默跳过。Tool 中断恢复的核心是 MCP handler 把所有异常转成 tool_results 不 raise，后续 LLM 收到格式正确的 tool-result 消息继续对话。流中断用 MidStreamFallbackError 让 Router 切 fallback 模型，如果首 chunk 已发出就注入 continuation prompt 续写。"

---

## Q9：流式转发（SSE）过程中如果上游断连，你怎么处理？

### 回答框架

1. **传输层 — aiohttp 优雅降级**：
   - `AiohttpResponseStream.__aiter__` 捕获 `ClientPayloadError`（传输不完整）、`RuntimeError("Connection closed")`（SSE 连接关闭）、`TransferEncodingError`，都 graceful return（当作正常流结束）
   - `map_aiohttp_exceptions` 把 aiohttp 异常映射为 httpx 兼容类型，统一后续处理

2. **HTTP 层 — httpx RemoteProtocolError 重试**：
   - `AsyncHTTPHandler` 的 post/put/patch/delete 都有：捕获 `RemoteProtocolError` + `ConnectError` → 创建新 client 重试一次
   - `httpx.TimeoutException` → raise `litellm.Timeout`

3. **流处理器层 — MidStreamFallbackError**：
   - `CustomStreamWrapper._handle_stream_fallback_error` 映射异常为 OpenAI 兼容类型
   - 非可重试 4xx（除 429）直接 raise；其他包装为 `MidStreamFallbackError`
   - 携带 `generated_content`（已生成内容）和 `is_pre_first_chunk`（是否首 chunk 前断连）

4. **Router 层 — fallback 模型续写**：
   - `stream_with_fallbacks` 捕获 `MidStreamFallbackError`，用 fallback 模型重试
   - 首 chunk 前：直接用原始 messages 重试
   - 首 chunk 后：注入 continuation prompt + `generated_content`（prefix=True）让 fallback 续写

5. **客户端断连**：
   - `GeneratorExit` 不被 `except Exception` 捕获，在 `finally` 块用 `anyio.CancelScope(shield=True)` 确保上游连接关闭 + partial spend flush
   - 防止连接池耗尽

6. **现有重复检测**：`raise_on_model_repetition` 检测连续相同 chunk，超过 `REPEATED_STREAMING_CHUNK_LIMIT` 次 raise `InternalServerError` 触发 Router 重试

### 代码佐证

| 要点 | 文件 | 行号 |
|---|---|---|
| aiohttp 优雅降级 | `litellm/llms/custom_httpx/aiohttp_transport.py` | lines 84-118, `AiohttpResponseStream.__aiter__` |
| 异常映射表 | 同上 | lines 19-47, `AIOHTTP_EXC_MAP` |
| httpx RemoteProtocolError 重试 | `litellm/llms/custom_httpx/http_handler.py` | lines 645, 708, 769, 830 |
| MidStreamFallbackError 定义 | `litellm/exceptions.py` | line 947 |
| 流中断错误处理 | `litellm/litellm_core_utils/streaming_handler.py` | lines 2365-2438 |
| Router fallback | `litellm/router.py` | lines 2116-2258, `stream_with_fallbacks` |
| async_data_generator | `litellm/proxy/proxy_server.py` | lines 6933-7062 |
| StreamingCallbackError 处理 | 同上 | lines 7033-7048 |
| combined_generator | `litellm/proxy/common_request_processing.py` | lines 345-365 |
| Client disconnect flush | `litellm/passthrough/main.py` | line 446 |
| Shielded cleanup | `litellm/litellm_core_utils/streaming_handler.py` | line 204, `aclose` |
| 重复检测 | 同上 | lines 261-297, `raise_on_model_repetition` |
| Session recreation | `litellm/llms/custom_httpx/aiohttp_transport.py` | line 315 |
| stream_timeout | `litellm/router.py` | line 3211, `_get_stream_timeout` |
| Max streaming duration | `litellm/litellm_core_utils/streaming_handler.py` | lines 107-117 |

### 流式转发完整链路

```text
HTTP Transport (aiohttp) → CustomStreamWrapper → Router FallbackStreamWrapper
  → Proxy iterator_hook (guardrails) → async_data_generator (SSE 格式化)
  → combined_generator (tracing) → StreamingResponse (FastAPI)
```

### 话术

> "四层处理：传输层 aiohttp 捕获 ClientPayloadError/Connection closed 优雅降级；HTTP 层 httpx RemoteProtocolError 创建新 client 重试一次；流处理器把异常映射为 MidStreamFallbackError 携带已生成内容；Router 层用 fallback 模型续写，首 chunk 前直接重试，首 chunk 后注入 continuation prompt。客户端断连时 GeneratorExit 不被 except 捕获，finally 块用 anyio shield 确保上游连接关闭和 partial spend flush。"

---

## Q10：LiteLLM Proxy 你做了二次开发还是纯配置？哪些是自研的？

### 回答框架

**是二次开发，不是纯配置。** 仓库是 BerriAI/LiteLLM 的 fork，主要自研模块如下：

| 自研模块 | 说明 | 关键文件 |
|---|---|---|
| **Auto Router（语义路由）** | 全新路由策略，用 LLM 分析 query intent 打分选模型，含 Midea 专有模型能力数据库（~18 个模型的推理/上下文/代码/工具/成本/速度评分） | `litellm/router_strategy/auto_router/` 整个目录 |
| **JWT + Team 混合鉴权** | `user_team_auth()` 自定义 FastAPI 依赖，JWT 解码 + team_alias 解析 + 用户自动入 team + scene 鉴权 + midea-gtrace-id 传播 + 鉴权耗时埋点 | `litellm/proxy/auth/user_api_key_auth.py`（lipy107 61 次 touch） |
| **JWT Team 映射** | JWT 解码后按 team_alias → team_id 映射，带 Redis 缓存 | `litellm/proxy/auth/handle_jwt.py` |
| **多级 Budget 治理** | 个人限额优先控制、team member 预算、budget reservation 原子增量+回滚、auto router 过滤付费模型 | `litellm/proxy/auth/auth_checks.py`、`litellm/proxy/spend_tracking/budget_reservation.py` |
| **Provider 适配** | Vertex AI 走 Midea AIMP 网关（`AIMP_HOST`）；Bedrock 支持 `midea_url`/`midea_stream_url` 重定向；DashScope cache_control 保留 | `litellm/llms/vertex_ai/common_utils.py`、`litellm/llms/bedrock/chat/converse_handler.py` |
| **性能优化** | 防雪崩（membership_lookup_ok）、并行化（asyncio.gather）、缓存键统一、pre-fetched 透传、team_member_add 异步化、耗时埋点 | `auth_checks.py`、`user_api_key_auth.py`、`handle_jwt.py`（13+ commits） |
| **部署与测试** | SIT/Custom/Monitor Dockerfile、压测脚本、DB 诊断工具、加解密工具 | `Dockerfile.sit`、`lipy_tests/` 整个目录 |

**纯配置部分**：模型列表（`models_config/`）、环境配置（`*.yaml`）、guardrail 规则、router fallback 策略参数。

**核心区别**：
- Auto Router 不是配置，是全新代码 — 用 LLM 做语义路由，有专有 prompt 模板和模型能力评分数据库
- JWT + Team 鉴权不是配置，是自定义 FastAPI 依赖 — 入口 B 是全新鉴权路径
- Budget 治理不是配置，是改了 `common_checks` 的检查逻辑和优先级
- Provider 适配改了核心 LLM adapter，不是配置

### 代码佐证

| 自研模块 | 文件 | 关键证据 |
|---|---|---|
| Auto Router | `litellm/router_strategy/auto_router/auto_router.py` | 全新 `AutoRouter` class，extends `CustomLogger` |
| 模型能力数据库 | `litellm/router_strategy/auto_router/constant.py` | ~18 个模型的 `ModelCapability` dataclass，中文注释 |
| Auto Selector | `litellm/router_strategy/auto_router/auto_selector.py` | 调用 `aimpapi.midea.com` 做 LLM 评分 |
| JWT 混合鉴权 | `litellm/proxy/auth/user_api_key_auth.py` | `user_team_auth()` 函数，lipy107 61 次 touch |
| midea-gtrace-id | 同上 | header 读取传播 |
| 鉴权耗时埋点 | 同上 | `_mark()` / `_emit_auth_breakdown()` |
| AIMP 网关 | `litellm/llms/vertex_ai/common_utils.py` | `AIMP_HOST = os.getenv("AIMP_HOST", "https://aimpapi.midea.com")` |
| Bedrock 重定向 | `litellm/llms/bedrock/chat/converse_handler.py` | `midea_url` / `midea_stream_url` |
| Budget reservation | `litellm/proxy/spend_tracking/budget_reservation.py` | `_BudgetCounter` + rollback |
| SIT 压测 | `lipy_tests/stress_test.py` | 打 `apisit.midea.com` |
| DB 加解密 | `lipy_tests/decrypt_litellm_params.py` | PyNaCl SecretBox 解密 |

### 话术

> "是二次开发，不是纯配置。最大的一块是 Auto Router — 全新的语义路由策略，用 LLM 分析 query intent 打分选模型，有专有的模型能力评分数据库。鉴权方面自研了 `user_team_auth` 这条 JWT + team_alias + scene 的混合鉴权路径，开源 LiteLLM 没有这个入口。Budget 改了 common_checks 的检查逻辑和优先级。Provider 适配改了 Vertex AI 走 Midea AIMP 网关、Bedrock 支持 midea_url 重定向。纯配置的部分是模型列表、环境 yaml、guardrail 规则参数。"

---

## 附：10 题快速对照表

| # | 问题关键词 | 一句话答案 | 核心代码位置 |
|---|---|---|---|
| Q1 | 4308ms 瓶颈 | 三个病根：阻塞写 + 雪崩 + 串行查询，靠 `_timed_auth_db_step` 埋点定位 | `d53d288e0c` |
| Q2 | 阻塞写移出 | `team_member_add` 改 fire-and-forget，fail-open 可接受 | `c4c83685c7` |
| Q3 | 并行查询 | `asyncio.gather` + `return_exceptions=True`，逐个检查结果 | `88a5fa1403`、`5ab4442634` |
| Q4 | 缓存一致性 | Cache Aside，TTL 按变更频率分类，缓存键统一消除穿透 | `5ab4442634` |
| Q5 | 鉴权模型 | 解耦+收敛+单点强制，JWT 认证映射 team_key 授权 | `user_api_key_auth.py` |
| Q6 | Budget 并发 | INCRBYFLOAT 原子增量 + SET NX 防翻倍 + reservation rollback | `auth_checks.py:494-776` |
| Q7 | 输出质量 | 规划功能，iterator hook + 滑动窗口 + n-gram 重复率 + 三级拦截 | `custom_logger.py:466` |
| Q8 | 异常不污染 | SSE 不泄露 traceback，MCP 异常转 tool_results，MidStreamFallback 续写 | `proxy_server.py:7036` |
| Q9 | SSE 断连 | 四层：aiohttp 优雅降级 → httpx 重试 → MidStreamFallbackError → Router fallback | `aiohttp_transport.py:84` |
| Q10 | 二次开发 | Auto Router 全新 + JWT 混合鉴权 + Budget 治理 + Provider 适配 | `router_strategy/auto_router/` |
