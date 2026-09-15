# 面试复习要点与可能提问

## 一、项目深挖问题

### 1. 企业大模型 API 网关优化

**简历关键点：** 基于 LiteLLM Proxy，统一模型接入/鉴权/配额/流式转发/服务治理，鉴权耗时 4308ms→412ms（降 90%）

**可能提问：**

- [ ] 鉴权链路原来 4308ms 的瓶颈在哪？你是怎么定位的？（埋点方案具体怎么做的）
- [ ] "高耗时写操作移出关键路径"具体指什么操作？移到哪里了？异步写会不会有一致性问题？
- [ ] asyncio 并行查询具体并行了哪些查询？如果某个查询失败了怎么处理？
- [ ] L1 + Redis 多级缓存的一致性如何保证？缓存键统一方案是什么？怎么消除冗余查询？
- [ ] User/Team/Scene/JWT 多维鉴权的模型设计？Token 校验流程？
- [ ] 多级 Budget 管控：个人/Team Member/Team 的扣减顺序和并发安全怎么做的？
- [ ] 模型输出质量治理：Thinking 循环重复检测算法是什么？乱码/异常字符怎么定义和检测？
- [ ] 异常拦截后如何避免污染后续上下文？Tool 调用被中断后 Agent 怎么恢复？
- [ ] 流式转发（SSE）过程中如果上游断连，你怎么处理？
- [ ] LiteLLM Proxy 你做了二次开发还是纯配置？哪些是自研的？

### 2. OpenCode Sandbox Plugin

**简历关键点：** 基于 Anthropic sandbox-runtime SDK，Bubblewrap + Docker 隔离 Bash 命令

**可能提问：**

- [ ] Bubblewrap 和 Docker 各自的隔离原理？为什么两者结合使用而不是只用 Docker？
- [ ] Sandbox Plugin 的调用链路：Agent 发起 Bash 命令 → 你的插件拦截 → 沙箱执行 → 返回结果，整个流程是怎样的？
- [ ] 沙箱里的文件系统怎么处理？Agent 需要读写宿主机文件怎么办？
- [ ] Hooks 机制的设计：文件读取/命令执行时如何识别敏感信息？脱敏规则是什么？
- [ ] 如果 Agent 试图执行 `rm -rf /` 或读取 `/etc/passwd`，你的防护策略是什么？
- [ ] 沙箱启动的性能开销？有没有做沙箱预热/池化？
- [ ] Anthropic sandbox-runtime SDK 的核心 API 你用了哪些？

### 3. 营销抽奖系统

**简历关键点：** Redis setNx+incr 库存扣减、分布式锁、RabbitMQ 解耦发奖、XXL-Job 补偿、Dubbo+Nacos

**可能提问：**

- [ ] Redis 库存扣减的完整流程：setNx 加锁 → incr 扣减 → decr 回滚，画一下时序图
- [ ] 分布式锁 Key = 占用编号 + 活动结束时间，为什么这么设计？锁过期了但业务没执行完怎么办？
- [ ] Kafka 异步补偿库存的具体流程？和 RabbitMQ 发奖为什么用两个不同的 MQ？
- [ ] 压测下无超卖——压测的 QPS 是多少？怎么测的？发现了什么问题？
- [ ] 4 类奖品分发的抽象工厂模式：类图是怎样的？新增一类奖品需要改哪些代码？
- [ ] 幂等保障：事务 + 唯一索引，唯一索引建在哪些字段上？MQ 重复消费怎么处理？
- [ ] XXL-Job 跨分库分表扫描补偿重发：分页查询怎么做的？扫到中间数据变了怎么办？
- [ ] 活动状态机有几种状态？状态转换图？决策树规则引擎的规则怎么配置？
- [ ] Dubbo + Nacos：服务注册发现流程？Dubbo 的负载均衡策略用了哪种？
- [ ] 高并发下 Redis 热 key 问题怎么处理？

### 4. 三维高斯泼溅雨夜重建

**可能提问：**

- [ ] 3D Gaussian Splatting 的基本原理？和 NeRF 的区别？
- [ ] 雨滴/雨丝在重建中会造成什么退化？你的感知流水线怎么处理的？
- [ ] 低照度场景下特征匹配的难点？你怎么解决的？
- [ ] CCF-B 期刊在投，你的核心创新点是什么？
- [ ] 这个项目和工程开发岗的关系？你怎么看研究 vs 工程的平衡？

---

## 二、Java 八股文

### JVM

- [ ] JVM 内存区域划分：堆/栈/方法区/程序计数器，各存什么？
- [ ] GC 算法：标记-清除、标记-复制、标记-整理，各自适用场景？
- [ ] CMS vs G1 vs ZGC 的区别？G1 的 Region 模型？
- [ ] 对象什么时候进入老年代？（年龄阈值、大对象、动态年龄判断）
- [ ] GC Roots 有哪些？
- [ ] 类加载机制：双亲委派模型，为什么要双亲委派？Tomcat 怎么打破的？
- [ ] 什么情况下会发生 OOM？你怎么排查？（jmap/jstack/jstat/MAT）
- [ ] 强引用/软引用/弱引用/虚引用的区别和应用场景？

### 并发

- [ ] synchronized vs ReentrantLock 的区别？锁升级过程（偏向锁→轻量级锁→重量级锁）？
- [ ] volatile 的两个语义：可见性和禁止指令重排，怎么实现的（内存屏障）？
- [ ] AQS 原理：state + CLH 队列，ReentrantLock 的公平/非公平实现？
- [ ] ThreadPoolExecutor 参数：corePoolSize/maxPoolSize/队列/拒绝策略？
- [ ] 线程池工作流程：核心线程→队列→非核心线程→拒绝策略
- [ ] ThreadLocal 原理：ThreadLocalMap，内存泄漏问题？
- [ ] CAS 原理？ABA 问题？怎么解决（版本号/AtomicStampedReference）？
- [ ] ConcurrentHashMap：JDK7 分段锁 vs JDK8 CAS+synchronized+红黑树
- [ ] CountDownLatch vs CyclicBarrier vs Semaphore？
- [ ] CompletableFuture 的用法（你项目里 asyncio 并行查询的 Java 等价物）

### 集合

- [ ] HashMap：数组+链表+红黑树，扩容机制（负载因子 0.75、容量翻倍），hash 计算
- [ ] HashMap 多线程下死循环问题（JDK7 头插法），JDK8 改尾插法还有问题吗？
- [ ] ArrayList vs LinkedList：底层实现、扩容、随机访问性能
- [ ] TreeMap 底层红黑树，Comparator vs Comparable

---

## 三、数据库八股

### MySQL

- [ ] InnoDB vs MyISAM 区别？
- [ ] B+ 树为什么适合做索引？（对比 B 树、Hash 索引）
- [ ] 聚簇索引 vs 非聚簇索引？回表是什么意思？覆盖索引？
- [ ] 索引最左前缀原则？联合索引 (a,b,c) 哪些查询能走索引？
- [ ] 索引下推（ICP）是什么？
- [ ] MVCC 原理：undo log + read view + 隐藏字段（trx_id, roll_pointer）
- [ ] RR 隔离级别怎么解决幻读？（间隙锁 + 临键锁）
- [ ] 四种隔离级别：读未提交/读已提交/可重复读/串行化
- [ ] binlog vs redo log vs undo log 的区别和作用？
- [ ] 两阶段提交：redo log prepare → binlog write → redo log commit
- [ ] MySQL 主从同步原理？binlog 格式（statement/row/mixed）？
- [ ] 分库分表：水平拆分策略？分片键选择？跨分片查询怎么办？
- [ ] 慢 SQL 排查：EXPLAIN 的 type/key/rows/Extra 怎么看？
- [ ] 你抽奖系统的分库分表方案是什么？怎么分的数据？

### Redis

- [ ] Redis 为什么快？（内存、单线程、IO 多路复用、高效数据结构）
- [ ] Redis 五种基本数据类型底层实现：SDS、ziplist/listpack、quicklist、skiplist、intset、hashtable
- [ ] Redis 持久化：RDB vs AOF，混合持久化？
- [ ] 缓存穿透（布隆过滤器）、缓存击穿（互斥锁/逻辑过期）、缓存雪崩（随机过期时间/多级缓存）
- [ ] 缓存一致性策略：Cache Aside（先更新 DB 再删缓存）、延迟双删
- [ ] Redis 分布式锁：setNx + 过期时间的问题？Redisson 看门狗机制？
- [ ] Redis 集群模式：主从、哨兵、Cluster（槽位 16384）？
- [ ] 你项目中 Redis 的使用场景：库存扣减、分布式锁、缓存——各自用了什么数据结构？
- [ ] Redis 6 多线程模型了解吗？

---

## 四、框架八股

### Spring

- [ ] IOC 的理解？Bean 的生命周期？
- [ ] AOP 原理：JDK 动态代理 vs CGLIB 代理？
- [ ] Spring 事务传播行为：7 种（REQUIRED/REQUIRES_NEW/NESTED...）
- [ ] @Transactional 失效场景？（自调用、非 public、异常被吞、传播级别错误）
- [ ] Spring 循环依赖怎么解决？（三级缓存：singletonObjects/earlySingletonObjects/singletonFactories）
- [ ] BeanFactory vs ApplicationContext？

### SpringBoot

- [ ] 自动装配原理：@SpringBootApplication → @EnableAutoConfiguration → spring.factories / AutoConfiguration.imports
- [ ] 启动流程：run() 方法做了什么？
- [ ] 内嵌 Tomcat 的原理？

### SpringCloud Alibaba

- [ ] Nacos 注册中心 vs Eureka 的区别？Nacos 的 AP/CP 切换？
- [ ] Nacos 配置中心：动态刷新原理（长轮询）？
- [ ] Dubbo vs Feign 的区别？Dubbo 的服务暴露和引用流程？
- [ ] Dubbo 的 SPI 机制 vs Java SPI？
- [ ] Sentinel 流控/熔断/降级规则？
- [ ] 服务雪崩原因？熔断器状态机（closed/open/half-open）？

---

## 五、消息队列八股

### RabbitMQ

- [ ] RabbitMQ 核心概念：Exchange（direct/fanout/topic/headers）+ Queue + Binding
- [ ] 消息可靠性投递：confirm 模式 + return 回调 + 持久化
- [ ] 消费幂等怎么保证？（唯一 ID + 数据库唯一索引 / Redis setNx）
- [ ] 死信队列：消息什么时候进死信？（TTL 过期、队列满、被 reject）
- [ ] 你项目中发奖解耦的具体流程：生产者→Exchange→Queue→消费者，画一下架构图

### Kafka（对比了解）

- [ ] Kafka 为什么高吞吐？（顺序写、零拷贝、分区并行、批量压缩）
- [ ] Kafka 的 ISR 机制？acks 参数？
- [ ] Kafka 重复消费和消息丢失问题？
- [ ] 你项目中为什么用 Kafka 做异步补偿库存而不是 RabbitMQ？

---

## 六、分布式系统

- [ ] 分布式锁实现方案对比：Redis（Redisson）/ ZooKeeper / MySQL
- [ ] 分布式事务方案：2PC/TCC/Seata（AT 模式）/ 本地消息表/事务消息
- [ ] 你抽奖系统的事务边界怎么划的？跨服务一致性怎么保证？
- [ ] CAP 定理？BASE 理论？
- [ ] 一致性 Hash 原理？虚拟节点的作用？
- [ ] 限流算法：计数器、滑动窗口、令牌桶、漏桶
- [ ] 你项目中 Budget 管控的限流/配额控制怎么做的？

---

## 七、网络八股

- [ ] TCP 三次握手/四次挥手，为什么三次/四次？TIME_WAIT 的作用？
- [ ] HTTP 1.0 vs 1.1 vs 2.0 vs 3.0 的区别？
- [ ] HTTPS 握手过程？对称加密 vs 非对称加密？
- [ ] 从浏览器输入 URL 到页面渲染发生了什么？
- [ ] SSE（Server-Sent Events）的原理？你项目中流式转发用的 SSE 还是 WebSocket？
- [ ] HTTP 长连接 vs WebSocket 的区别？

---

## 八、操作系统

- [ ] 进程 vs 线程 vs 协程的区别？你项目里 asyncio 用的是协程，和线程的区别？
- [ ] Linux 进程间通信方式：管道/消息队列/共享内存/信号量/Socket
- [ ] Docker 隔离原理：namespace（pid/net/mnt/uts/ipc/user）+ cgroups
- [ ] Bubblewrap 的隔离原理和 Docker namespace 有什么区别？
- [ ] 虚拟内存、页表、TLB？
- [ ] IO 模型：阻塞/非阻塞/IO 多路复用（select/poll/epoll）/异步 IO

---

## 九、AI Agent 相关

- [ ] OpenCode 的架构？插件体系怎么设计的？
- [ ] DeepSeek-Harness 基于 cordis api 的 plugin 开发，cordis 是什么？
- [ ] Agent 的 Tool Use 机制：Function Calling / Tool 调用链路？
- [ ] LLM 流式输出（SSE/chunk）的处理逻辑？thinking content 怎么区分？
- [ ] Prompt Engineering 的经验？System Prompt 怎么设计？
- [ ] 你怎么看待 AI Agent 在企业落地的安全风险？
- [ ] RAG vs Fine-tuning 的选择？
- [ ] LiteLLM 的路由策略：多个模型 provider 之间怎么做 failover？

---

## 十、场景设计题

- [ ] 设计一个高并发抽奖系统（100w QPS），怎么设计？
- [ ] 如果库存 100 件，10 万人同时抽，你怎么保证不超卖且高性能？
- [ ] 设计一个 AI Agent 执行沙箱，安全性和性能怎么平衡？
- [ ] 如果 API 网关每天处理 1 亿次调用，你的鉴权方案怎么扩展？
- [ ] 消息堆积了 100 万条，你怎么处理？

---

## 复习优先级建议

| 优先级 | 内容 | 原因 |
|--------|------|------|
| P0 | 项目深挖（全部） | 面试必问，且考察真实理解 |
| P0 | Redis 分布式锁/缓存/库存 | 直接对应你抽奖系统 |
| P0 | 并发/线程池/锁 | Java 后端核心 |
| P1 | MySQL 索引/MVCC/分库分表 | 对应分库分表经验 |
| P1 | RabbitMQ 可靠性/幂等 | 对应发奖链路 |
| P1 | Spring 事务/AOP/IOC | 框架必问 |
| P2 | JVM/GC | 大厂必问，中小厂选问 |
| P2 | 网络/操作系统 | 基础题，答上加分 |
| P2 | AI Agent 相关 | 差异化亮点，体现前沿 |
| P3 | Kafka/Sentinel | 对比了解即可 |
