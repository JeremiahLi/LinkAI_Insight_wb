# Agent 运维平台实施计划

> 定位：把现有「Agent 运行状态可视化 + 实验评测」扩展为可闭环的运维系统最小集。
> 判据：一名 Agent 开发者在不看代码库的情况下，能回答四个问题 —— 出了什么问题、在哪出的、为什么出、新版本有没有修好。
> 本文所有现状数字均取自 `prisma/dev.db`（243 会话）实测，非估算。

---

## 一、现状基线

### 1.1 已有能力

| 层 | 能力 | 落点 |
|---|---|---|
| 采集 | span 级 trace 上报（user / llm_thinking / tool_call / answer / system_prompt） | `src/app/api/sessions/upload/route.ts` |
| 存储 | Session / Span / Agent / Project / Skill / BusinessMetric | `prisma/schema.prisma` |
| 可视化 | trace 甘特图、会话列表、Agent 看板、用户/技能/LLM 看板 | `src/app/(main)/*` |
| 聚合 | 四维健康分、异常阈值、错误聚类、慢 span | `src/lib/engine/stats/*` |
| 评测 | 7 个规则评估器 + 6 个 LLM judge、实验与 A/B 对比 | `src/lib/engine/experiment/*` |

### 1.2 实测数据分布

```
Span 类型：tool_call 4883 · llm_thinking 3073 · answer 851 · user 699 · system_prompt 696 · turn_start 4
Session 终态：success 133 · partial 68 · failed 18 · 空 24
```

三个必须先修的数据缺陷：

**缺陷 A：26.3% 的 answer span 输出为空（224 / 851）。**
`session-data.ts` 与 `judge-assembly.ts` 用 `!actualOutput` 取**首条非空** answer。对于多轮会话，这条通常是中间轮次的进程性回复，而不是最终交付物。实测一个 4 轮会话有 10 个 answer span，只有末条有内容（810 字符）。用它当 `actualOutput` 送进 judge，评的是中间态。

**缺陷 B：`session_start` span 全库 0 条。**
`upload/route.ts:128` 的版本取值 `sessionStartSpan.agent_version` 永远回退到 `'1.0.0'`。26 个 Agent 里有 3 个版本号非 1.0.0（如 `CBB治理智能体` 1.2.0），只能来自手工录入。**版本信息实际不存在。**

**缺陷 C：18 条 failed 会话的末条 answer 全部为空，其中 9 条此前有过非空 answer。**
一半的 failed 是「前面有交付、最后一轮无输出」。需要区分两种情况：用户追问后 Agent 未回复（真失败）vs 采集端结束时补写空 answer span（假失败）。当前无法区分。

### 1.3 与上一轮判断的差异（修正）

- 上一轮称「版本快照需改采集端契约」——**成立**，且比预想更严重：不是契约不够细，是 `session_start` span 根本没上报。
- 上一轮称「首条 answer 不是交付物」——**结论成立，机理需修正**：代码会跳过空 output，取到的是「首条非空 answer」，不是「第一条」。但危害相同：评的是中间态。
- 新增发现：缺陷 C 会直接污染 `Session.outcome` 分母，所有成功率类指标的可信度待验证。

---

## 二、设计原则

1. **诊断与打分分离。** 现状把两者塞进同一个 `EvalOutput{score, summary, issues}`（`evaluator-types.ts`），导致 judge 去猜"哪一步坏了"、detector 被迫给分数。拆成三个独立单元：
   - `Detector`：确定性，输入统计/轨迹，输出 `Finding[]`（不带分数）
   - `Diagnoser`：LLM，输入裁剪后的失败上下文，输出结构化根因分类 + 证据 + 置信度
   - `Scorer`：仅用于 case 级打分与版本对比
2. **检测驱动入集。** 回归集不从会话列表手工挑，由 `Finding` 一键生成 `Case`，并回填 `srcIssueId`。
3. **版本可追溯。** `Session.agentVersion` 是事实快照（不可变），`Release` 表是变更解释（gitSha / promptHash / model）。两者都要，缺一不可。
4. **口径单一来源。** 成功率只走 `session-outcome.ts` 的 `SQL_*` 与 `health.ts` 的 `successRateOf`；新增统计禁止另写口径。

---

## 三、目标态数据模型

### 3.1 schema 增量

```prisma
/// 版本发布记录：变更事件的时间锚点，用于「指标劣化 ← 哪次发布」关联
model Release {
  id         String   @id @default(cuid())
  agentId    String
  version    String
  /// 代码版本，空串表示未采集
  gitSha     String   @default("")
  /// 系统提示词内容哈希，用于识别 prompt 改动
  promptHash String   @default("")
  /// 主要模型名
  model      String   @default("")
  notes      String   @default("")
  releasedAt DateTime @default(now())
  createdAt  DateTime @default(now())

  @@unique([agentId, version])
  @@index([agentId, releasedAt])
}

/// 问题单：把散落在内存里的 issue 变成可追踪、可验证、可复发的实体
model Issue {
  id          String   @id @default(cuid())
  agentId     String
  /// FindingType 枚举值，见 src/lib/engine/detect/types.ts
  type        String
  severity    String   @default("warning")
  /// type + 归一化特征（如 tool_failure:bash:EACCES），跨会话跨版本识别同一问题
  fingerprint String
  title       String
  evidenceJson String  @default("[]")
  /// 代表样例
  sessionId   String?
  spanId      String?
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  occurrences Int      @default(1)
  /// open | ack | fixed | wontfix | stale
  status      String   @default("open")
  /// 关闭该问题的版本；用于验证"新版本是否修好"
  fixedInVersion String   @default("")
  /// 由本问题派生的回归用例，JSON 数组存 caseId
  caseIdsJson String   @default("[]")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([agentId, fingerprint])
  @@index([agentId, status, severity])
  @@index([lastSeenAt])
}

/// 用户侧信号：唯一不依赖 judge 的 ground truth
model SessionFeedback {
  id        String   @id @default(cuid())
  sessionId String
  /// thumbs_up | thumbs_down | reask | abandon | adopt
  kind      String
  /// 自由备注（人为输入可空）
  note      String   @default("")
  by        String   @default("")
  createdAt DateTime @default(now())

  @@index([sessionId])
  @@index([kind, createdAt])
}
```

### 3.2 既有表增量

```prisma
model Session {
  /// 产生本会话的 Agent 版本快照。空串表示未知（历史数据不回填，避免造假）
  agentVersion String @default("")
  ...
  @@index([agentId, agentVersion, startTime])
}

model ExperimentCase {
  /// 来源问题单：检测驱动入集的可追溯链
  srcIssueId String?
  /// 期望行为（人工填写或诊断建议），作为 referenceOutput 的候选来源
  expectedBehavior String @default("")
  ...
  @@index([srcIssueId])
}

model Experiment {
  /// 评测时的 judge 模型快照。同一对比组内禁止变更，否则分数不可比
  judgeModel String @default("")
  /// 门禁基线：本实验对照组
  baselineExperimentId String?
}
```

### 3.3 迁移方式

本项目无 migrations 目录，走 db push：

```bash
NODE_OPTIONS= ./node_modules/.bin/prisma db push --skip-generate
NODE_OPTIONS= ./node_modules/.bin/prisma generate
```

注意：改 schema 后必须重新 `generate`，否则 Turbopack 外部化的 `@prisma/client-<hash>` 会与实际 client 不一致（详见 MEMORY.md 的离线包坑）。开发库变更后如需交付离线包，需重跑 `prisma generate → next build`。

---

## 四、分期计划

依赖关系：M0 是一切的前提（数据不可用则后续全部失真）。M1 → M2 → M3 严格串行（M2 依赖 Issue 实体，M3 依赖 Case 与 Release）。M4 可与 M3 并行。

```
M0 地基修正 ──> M1 Issue 与诊断 ──> M2 回归集自生长 ──> M3 版本验证与门禁
                                              └──> M4 告警与用户信号（可并行）
```

---

### M0 地基修正（预估 1.5 人日）

**目标**：让后续所有统计与评测站在可信数据上。

| # | 任务 | 改动点 | 验收 |
|---|---|---|---|
| 0.1 | 用例抽取口径修正：取「末条非空 answer」，多轮会话按轮拆 case | `src/lib/engine/experiment/session-data.ts`、`judge-assembly.ts` | 抽样 30 个多轮会话，抽取结果非空率 ≥ 95%；与实际交付物一致率 ≥ 90% |
| 0.2 | 版本快照落列 | `upload/route.ts` upsert 的 `create` 分支加 `agentVersion`；**update 分支不得覆盖** | 新上传会话的 `agentVersion` 非空率 = 采集端上报率 |
| 0.3 | 采集端契约扩展（客户端仓库） | `session_start` span 上报 `agent_version`、`agent_git_sha`、`prompt_hash`、`model` | 全库 `session_start` span 数量 > 0，且字段齐全 |
| 0.4 | 数据体检脚本 | 新增 `scripts/data-health.cjs`：answer 空值率、末条 answer 空且历史有交付的会话数、outcome 分布、session_start 覆盖率 | 输出一份基线报告，后续每次 schema 变更后复跑 |
| 0.5 | 假失败判定 | `computeOutcome` 增加：末条 answer 为空但存在历史非空 answer 且末条 user 无对应回复 → 单独记为 `truncated` | failed 会话中 `truncated` 占比可见，不再混入失败率分母 |

**风险**：0.5 会改变 `outcome` 语义，影响历史对比。处置：`truncated` 作为独立值，`successRateOf` 暂按 failed 计，但在详情页标注，观察两周后再决定是否剔除。

**为什么 0.3 不能等**：版本维度是 M3 的前置。session_start 覆盖率不上去，M3 做出来也只是空壳。这一项依赖外部仓库配合，是本计划唯一的跨团队阻塞点，应最先发起。

---

### M1 问题实体与根因诊断（预估 3.5 人日）

**目标**：把 `agent-detail.ts:546-652` 里 6 段内联 `issues.push` 抽出为可测试的检测器，并叠加 LLM 归因。

#### 1.1 检测器重构

新增目录 `src/lib/engine/detect/`：

```
types.ts         Finding / FindingType / Detector 接口
index.ts         注册表 + runDetectors(ctx)
tool-failure.ts  工具失败率（现有逻辑迁移）
error-cluster.ts 错误聚类（迁移）
slow-span.ts     慢调用（迁移）
decline.ts       使用衰退（迁移）
data-quality.ts  数据质量（迁移）
allowlist.ts     预期失败白名单（新增，见 1.3）
diagnoser.ts     LLM 根因归因（新增）
```

`Finding` 结构：

```ts
export interface Finding {
  type: FindingType;
  severity: "critical" | "warning" | "info";
  fingerprint: string;
  title: string;
  evidence: string[];
  sessionId?: string;
  spanId?: string;
  /** 归一化特征，用于聚合同类 */
  feature: Record<string, string | number>;
}
```

重构约束：`AgentIssue` 类型与前端组件 `agent-issue-list.tsx` 不改动，`runDetectors` 输出经适配层转 `AgentIssue`。这样 M1 可以随时回滚而不影响看板。

#### 1.2 根因分类（关键设计）

`Diagnoser` 输出必须落在**封闭枚举**内，否则无法聚合（"哪类根因占比最高"是运维第一问题）：

| 枚举值 | 含义 | 典型证据 |
|---|---|---|
| `prompt_ambiguity` | 指令或约束表述不清 | 模型反复澄清、要求确认 |
| `tool_arg_error` | 工具入参构造错误 | ENOENT / 引号转义失败 / 参数类型错 |
| `tool_env_error` | 环境、依赖、权限 | EACCES / command not found / 网络超时 |
| `context_missing` | 未读取必要信息就作答 | 轨迹无相关读取但输出含具体断言 |
| `context_overflow` | 上下文截断或遗忘 | 早期约束在后轮被违反 |
| `loop` | 重复无效调用 | 同参数调用 ≥3 次无进展 |
| `hallucination` | 编造事实或路径 | 输出引用不存在的文件/接口 |
| `downstream_error` | 外部服务返回错误 | 第三方 API 4xx/5xx |

**输入裁剪**（成本与精度的关键）：不送全轨迹。送「失败 span 的 input/output/error + 前后各 1 个 span + 该轮 user 诉求 + 该轮工具名序列」，总长度控制在 8K 字符以内。

**输出结构**：

```ts
interface Diagnosis {
  rootCause: RootCause;        // 上述枚举
  narrative: string;            // 一句话根因说明
  evidenceRefs: string[];       // 指向 spanId 或原文片段
  suggestion: string;           // 可执行的修复动作
  confidence: number;           // 0-1
}
```

置信度 < 0.5 时不写 `narrative` 的绝对判断，UI 上标「疑似」。避免"看起来很聪明实际在猜"。

#### 1.3 误报治理

`allowlist.ts` 内置预期失败规则，默认拦截下列情况（可在 settings 覆盖）：

- `grep` / `rg` 返回 "no matches" 或 exit code 1
- 测试命令返回非零（测试失败是信息，不是故障）
- 文件未找到但同轮内后续成功创建
- 用户主动中断（`turn_start` 后无 answer，且间隔 < 5s）

不治理误报，检测上线两周内就会被无视。

#### 1.4 Issue 生命周期

| 接口 | 语义 |
|---|---|
| `POST /api/issues/recompute` | 按 Agent + 时间窗重跑检测器，upsert 到 Issue（按 `agentId + fingerprint` 去重，累加 `occurrences`，更新 `lastSeenAt`） |
| `PATCH /api/issues/[id]` | 改 `status`；置 `fixed` 时必须填 `fixedInVersion` |
| `GET /api/issues?agentId=&status=` | 列表，按 severity + occurrences 排序 |

UI：Agent 详情页的 `AgentIssueList` 每项增加「标记已修 / 生成回归用例」两个动作。

#### 验收

- 人工复核 30 条 Finding：误报率 ≤ 30%（含 allowlist 拦截后）
- 同一 `fingerprint` 在两次重跑中稳定命中同一批会话（幂等）
- `runDetectors` 纯函数化，有单测覆盖（不依赖 prisma）

---

### M2 回归集自动生长（预估 2 人日）

**目标**：把「有问题的会话」变成「可复跑的验证用例」，且全流程 ≤ 2 次点击。

| # | 任务 | 改动点 |
|---|---|---|
| 2.1 | Finding → Case：从 Issue 生成用例，带轨迹快照 | 新增 `POST /api/issues/[id]/cases`，内部复用 `case` 创建逻辑，写 `srcIssueId`、`expectedBehavior` |
| 2.2 | 用例集管理：按 issue 类型 / 严重度 / 版本筛选组集 | `src/app/(main)/experiments/new/page.tsx` 增加「从问题单选起」入口 |
| 2.3 | 轨迹证据固化 | 生成 case 时把当时的 span 序列快照写入 `evaluatorContextJson`，避免原会话被清理后证据丢失 |
| 2.4 | 用例去重 | 同 `srcIssueId` + 同 mode 不重复建；相似度 > 0.9 的 input 提示合并 |

**验收**

- 从 Issue 列表点「生成回归用例」，到 case 可在实验中选中，≤ 2 次交互
- 原会话删除后，case 的 `evaluatorContextJson` 仍能独立完成评测
- 每个 `fixed` 的 Issue 至少关联 1 个 case（可用体检脚本检查）

---

### M3 版本验证与发布门禁（预估 3 人日）

**目标**：回答「新版本有没有提升、提升在哪、有没有回退」。

| # | 任务 | 改动点 |
|---|---|---|
| 3.1 | Release 录入 | `POST /api/releases`；采集端上报时自动 upsert（有 `agent_version` 即建记录） |
| 3.2 | 按版本切片统计 | `agent-detail.ts` / `agent-board.ts` 增加 `version` 维度查询参数；前端加版本选择器 |
| 3.3 | 版本对比报告 | `GET /api/experiments/compare?baseline=&candidate=` 扩展：输出「按 issue fingerprint 的复发/修复清单 + 规则通过率差 + judge 均分差 + 成本差」 |
| 3.4 | 门禁判定 | 新增 `POST /api/experiments/[id]/gate`，返回 `{ pass, blockers[] }` |
| 3.5 | judge 模型锁定 | `runExperiment` 启动时快照当前 judge 模型到 `Experiment.judgeModel`；对比时若两者不同则拒绝出结论 |

**门禁规则（初版，写死在代码里，不做成可配置）**

| 检查项 | 阈值 | 动作 |
|---|---|---|
| 规则型评估通过率 | 不得低于基线 -2pp | 否则 block |
| judge 均分 | 不得低于基线 -5 分 | 否则 block |
| 基线中 `fixed` 的 issue | 复发数必须为 0 | 否则 block |
| 单 case 成本（token） | 不得高于基线 +30% | 否则 warn |
| P95 单轮耗时 | 不得高于基线 +30% | 否则 warn |

**验收**

- 任选两个有数据的 Release，能生成一页对比报告，说明「修复了哪 3 个问题、引入了哪 1 个回退」
- judge 模型不同时，对比接口返回明确错误而不是静默出分

---

### M4 告警与用户信号（预估 2.5 人日，可与 M3 并行）

| # | 任务 | 说明 |
|---|---|---|
| 4.1 | 发布后劣化检测 | 新 Release 后 24h，若核心指标（成功率 / 规则通过率 / 平均单轮 token）劣于前 7 天基线超过阈值，生成 `Issue` 并推送 |
| 4.2 | 推送通道 | 先做单通道（邮件/企业微信 webhook 二选一），不做告警平台 |
| 4.3 | 用户信号采集 | `POST /api/sessions/[sessionId]/feedback`；trace 详情页加「有用/无用/重新提问」 |
| 4.4 | 放弃检测 | 按 `span` 间隔 > 10 分钟且末轮无 answer → 推断 abandon，写入 `SessionFeedback`（标 `by=auto`） |
| 4.5 | 信号进入评测 | thumbs_down 的会话按 M2 流程入集，优先级高于统计检测 |

**验收**：发布劣化后 24h 内收到通知，且通知里带一个可点击的样例会话。

---

## 五、采集端契约变更（与 M0 并行，跨仓库）

这是唯一的跨团队阻塞项，需最先对齐。要求新增/补齐字段：

| 字段 | 位置 | 用途 | 缺失后果 |
|---|---|---|---|
| `agent_version` | `session_start.agent` | 版本快照 | M3 全部失效 |
| `agent_git_sha` | `session_start.agent` | 变更定位 | 无法关联代码改动 |
| `prompt_hash` | `session_start` | prompt 改动识别 | 无法归因"改了提示词导致的回退" |
| `model` | `session_start` | 模型切换识别 | 混淆模型与 Agent 的影响 |
| `interrupted` | `answer` span | 用户中断标记 | 无法区分真失败与主动打断 |
| `prompt_version` | 每轮 `llm_thinking` | 轮级 prompt 归因 | 只能到会话级，粒度不足 |

兼容策略：全部字段可选，缺失时落默认值并在 `dataNotes` 里提示（沿用现有 `agent-detail.ts:700` 的 dataNotes 模式）。不要因为缺字段拒收数据。

---

## 六、口径定义（避免指标互相矛盾）

| 指标 | 定义 | 唯一实现 |
|---|---|---|
| 会话成功率 | `(1 - (failed + partial*0.5) / finished) * 100` | `health.ts:successRateOf` |
| 会话终态 | success / partial / failed / truncated / 空 | `session-outcome.ts` + M0.5 扩展 |
| 工具失败率 | `failed tool_call / 全部 tool_call`，排除 allowlist 命中 | `detect/tool-failure.ts` |
| 规则通过率 | `verdict=pass / 全部 verdict`（不含 failed 状态的 evaluator 执行） | M3 门禁接口 |
| judge 均分 | 同 judge 模型、同 evaluator 集合下的均值 | M3，跨模型禁比 |
| 健康分 | 四维（稳定性/效率/成本/活跃度），**不含正确性** | `health.ts:scoreHealth` |

最后一条要在 UI 上写明：健康分不是质量分。正确性只在评测分数与 Issue 修复率里体现。

---

## 七、明确不做（本期）

| 不做 | 理由 |
|---|---|
| 多租户 / 权限 / 用户体系 | 当前只有一个真实用户；抽象成本高于收益，会拖慢闭环 |
| trace 脱敏 / 数据分级 | 依赖多租户；开放给他人前再补 |
| 可配置告警规则引擎 | 先写死一条（发布后劣化），验证有用再抽象 |
| 全库 online judge 打分 | token 成本高、噪声大；应先 Detector 分诊再 judge |
| 自定义 evaluator 插件机制 | 现有 13 个评估器够用；先验证 judge 与人工一致率 |
| 综合质量分（把健康分与评测分合成一个数） | 加权口径无法自证；合成数一旦被当 KPI 会诱导刷分 |

---

## 八、风险登记

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| 采集端不配合改契约，`session_start` 仍为 0 | 高 | M3 空转 | M0.3 最先发起；兜底方案是用 upload body 顶层 `agentVersion` 手工传 |
| judge 与人工一致率 < 70% | 中高 | 分数不可用于版本对比 | M1 完成后立即做 30 条抽样对齐；不达标则 judge 降级为分诊信号，版本对比只认规则型 |
| 误报率高导致 Issue 被无视 | 中 | 闭环断裂 | allowlist 先做；M1 验收卡 30% 误报率 |
| Issue 表膨胀（每次重跑都 upsert） | 中 | 查询变慢 | 按 fingerprint 去重 + `lastSeenAt` 索引；occurrences 累加不新增行 |
| `outcome` 语义变更影响历史对比 | 中 | 趋势图断裂 | `truncated` 作为新值而非替换；图例标注生效日期 |
| 单人开发导致 M2/M3 延期 | 中 | 闭环半途 | M1 结束即可交付价值（问题单可用），M2/M3 可分批上 |

---

## 九、里程碑与验收总表

| 里程碑 | 交付物 | 可用性判据 |
|---|---|---|
| M0 | 数据可信 | 用例抽取非空率 ≥95%；`agentVersion` 有值；体检脚本可复跑 |
| M1 | 问题单 | Agent 详情页能看到带根因分类的 Issue，可标已修；误报率 ≤30% |
| M2 | 回归集 | Issue 一键入集；会话删除后 case 仍可评测 |
| M3 | 版本验证 | 任选两个 Release 出对比报告 + 门禁 pass/fail |
| M4 | 主动运维 | 发布劣化 24h 内通知；用户信号可入集 |

**整体成功判据（上线一个月后回看）**：
过去 30 天修复的问题中，≥ 60% 由平台检测触发而非人工翻 trace 发现。未达标说明检测模块价值不足，应先补检测而非继续加功能。

---

## 十、建议执行顺序（单人）

1. 今天：发采集端契约变更单（M0.3），这是唯一外部依赖，越早发起越好。
2. 第 1-2 天：M0.1 / 0.2 / 0.4 / 0.5。
3. 第 3-5 天：M1.1 检测器抽离（纯重构，可回滚）+ 1.3 allowlist。
4. 第 6-7 天：M1.2 diagnoser + 1.4 Issue 接口与 UI。此处即可交付第一版价值。
5. 第 8-9 天：M2。
6. 第 10-12 天：M3。
7. 第 13-15 天：M4。

M1 结束时应停下来做一次判断：把 30 条 Finding 与实际修复记录对齐，若平台检出率低于 50%，先别做 M2/M3，回头增强检测。

---

## 十一、执行日志

### 2026-11-02 · B1 错误语义化 + B2 失败因果链（已完成）

**新增文件**

| 文件 | 职责 |
|---|---|
| `src/lib/engine/detect/error-signature.ts` | 把 `Span.error` 归一为 `{kind, key, family, errorClass, target, summary, garbled}`；13 类签名 |
| `src/lib/engine/detect/failure-chain.ts` | 还原「失败 → 重试 → 结局」，输出 `retried_recovered / retried_failed / abandoned / fatal / isolated` |
| `src/lib/engine/detect/remediation.ts` | 确定性根因假设 + 修复动作（不依赖 LLM，可解释） |
| `scripts/analyze-agent.cjs` | CLI：按 Agent + 时间窗输出异常排行与明细 |

**新增 npm 脚本**：`detect:build`（编译检测模块到 `.tmp-verify/`，已 gitignore）、`detect:analyze`。

用法：`npm run detect:build && npm run detect:analyze -- <agentName|all> <days>`

**实测结果（近 180 天，243 会话 / 349 条工具错误）**

```
出现异常链的会话 69
异常链 281：重试自愈 237 / 未修复即交付 20 / 孤立失败 10 / 致命失败 11 / 连续失败 3
需处理 23
```

三个可复用的结论：

1. **84% 的工具失败是重试后自愈的。** 按 `errorCount` 或「错误 span 数」排名会把这 237 条当成问题，夸大约 10 倍。严重度必须由结局决定，这是 `failure-chain` 存在的唯一理由。
2. **分类质量达标**：`unknown` 4.6%（目标 < 20%），`not_an_error` 误写 5 条被单独剔除，用户主动中止 2 条已降级为 info。
3. **问题集中在四类**：pydantic 数据校验失败（8 条 / 4 会话）、编辑定位失败（3 条）、JSON 不合法、编码不一致。这四类都属于「Agent 生成的数据不合规」，是可修的确定性问题，不是模型能力问题。

**已知限制（需采集端配合）**

- 90 条（25.8%）error 文本含 U+FFFD（GBK 写入、UTF-8 解读），摘要不可读。签名仍能分类，但 UI 必须显式标注「原文编码损坏」，不能让用户对着乱码猜。
- `exit_code` 类 63 条无法进一步归因：脚本只输出退出码，不输出结构化原因。

**下一步**：B4 标注集（30 条）→ Diagnoser（8 类根因 + 证据）→ 接入 Agent 详情页。

### 2026-11-02 · UI 接入（已完成）

| 文件 | 职责 |
|---|---|
| `src/lib/engine/detect/agent-failures.ts` | IO + 聚合层：按 Agent 与时间窗拉 span、跑检测器、产出 DTO |
| `src/app/api/agents/[name]/issues/route.ts` | `GET /api/agents/[name]/issues?range=30d` |
| `src/components/agent/failure-analysis-panel.tsx` | 概览 + 类型排行（可展开根因与建议）+ 链路深链 |
| `agent-board/[name]/page.tsx` | 在「问题列表」下方新增「运行异常分析」卡片 |

**与既有「问题列表」的分工**（两处并存，不互相替代）：

| | 问题列表 | 运行异常分析 |
|---|---|---|
| 粒度 | 统计聚合 | 过程链路 |
| 回答 | 哪个工具在失败、失败率多高 | 这一次怎么失败、自愈没有、根因、怎么修 |
| 数据源 | 阈值 + 聚类 | 失败链 + 签名 + 规则建议 |

**实测**（26 个 Agent，近 30 天）

```
有会话的 Agent：14 / 26
有待处理异常的 Agent：4（pptagent1022 4 条、pptagenttrae 2 条、PPTAgent相关资料 1、jailhouse 1）
pi-coding-agent：30 天 65 个会话，仅 1 条待处理
```

API 响应 4~45ms（纯 SQL + 规则，无 LLM 调用），不构成页面负担。

**未完成的验证**：本机 3002 端口被另一项目（`AgentOps-Cursor`）占用，改用 3010 启动；无头浏览器被环境安全策略终止，**未做视觉验证**。已验证的是：TypeScript strict 通过、页面 200、客户端组件成功挂载并发起请求（dev 日志有 `/api/agents/agentcodebuddy/issues?range=30d` 200）、DTO 结构正确。样式与布局需人工打开页面确认。

### 2026-11-02 · 接口级成败对照（B3.5，已完成）

**触发原因（用户原话）**

> 「bash 失败 12 次（26.1%）… 建议检查该工具入参构造」这个建议太宽泛，我作为开发者依然不知道该怎么优化。

诊断成立：上层聚合停在**工具名**。`bash` 是万能容器，26% 的失败率无法定位到任何一行代码。可行动的单位是**同一条命令/同一个接口的成败对照**。

**新增**

| 文件 | 职责 |
|---|---|
| `src/lib/engine/detect/command-stats.ts` | 按「接口 + 归一化签名」聚合调用/失败/耗时，抽取成败样本并做 token 级入参差集 |
| `failure-analysis-panel.tsx` | 「接口级成败对照」区块：签名、调用数、失败数、失败率、p50、一行结论、展开看失败/成功入参原文 |
| `scripts/analyze-agent.cjs` | CLI 同步输出同一份对照 |

**关键设计**

1. **不合并接口别名。** 最初沿用 `normalizeToolName`（`edit`/`edit_file`/`write` → `edit`），实测立刻出现假结论：`edit 42-table.json` 的「成功样本」其实来自 `write`（入参只有 `path`，没有 `edits[].oldText`），两边根本不是同一个入参结构。库里 `write` 856 次、`edit_file` 634 次、`edit` 457 次，一旦混桶，成败对照全是编的。**按原始接口名分桶**。
2. **同任务重试优先配对。** 失败/成功样本先在同会话内配对（同一任务重试，差异才是「改了什么才成功」）；没有才退化到全局首样本，并标 `sameSession:false` 让 UI 提示「跨任务，仅供参考」。
3. **`identicalCommand` 是最有价值的信号。** 同一命令、同样入参，一次成功一次失败 → 问题不在入参，在它读写的输入数据或环境状态。此时改命令参数是零收益。

**实测（agentcodebuddy，5 会话，全时段）**

```
python merge.py            34 调用 / 18 失败 (53%)  入参与成功样本完全一致（同任务重试）→ 问题在 deck.json 内容
python -c 内联脚本          41 / 10 (24%)   失败用 open('...','rb')+read，成功用 glob.glob('*.json')
edit 42-table.json          5 / 4  (80%)   失败时 oldText 多带后半句「，和自托管模型处不来」
python render.py            7 / 3  (43%)   成功那次多了 tail -20 复查输出
read qc_report.txt          2 / 1  (50%)   成功用 E:\... 绝对路径，失败用 /tmp/...（WSL 风格路径）
```

最后一条是典型：**同一接口、同会话、只差路径写法**，直接指向「不要生成 `/tmp` 路径」。

**顺带修掉的两处展示噪声**

- `extractPayload` 给 edit 拼的 `--- 待替换片段 ---` 分隔行被 tokenDiff 当作参数差异，chips 里冒出 `---`/`待替换片段`。改为常量 + diff 前剔除。
- 纯符号 token（`&&`、`|`、反引号）不携带语义，过滤掉；超长中文 token 截断到 260px 并带 `title`，避免撑破 flex 行。

**验证方式（本次做成了）**

`chrome.exe --headless=new --screenshot`（**必须用绝对路径**，相对路径会报 0x3 找不到路径）在 3010 端口实际截图确认渲染：
`接口级成败对照` 标题 + `dir 100% 调用 1 · 失败 1 · p50 84ms` + 失败入参原文 + 红色错误摘要 + `R2 / 84ms / 链路`，`ls 4% 调用 26 · 失败 1 · p50 69ms` + 「成功那次多出 "E:/lijian/Files/"; 仅失败有 grep | ppt;」。无溢出、无错位。

### 2026-11-02 · 工具失败改为「洞察」而非通用处方（已完成）

用户反馈：问题列表里的工具失败只有「bash 失败 12 次（26.1%）+ 检查入参构造」，仍然不知道改哪一行。

`agent-detail.ts` 的 `tool_failure` issue 改为：

- 标题带主导失败点：`bash 失败 12 次（26.1%），python merge.py 占 58%`
- 证据给事实：调用/失败/均耗时/占全部工具失败比 ｜ 失败集中点（命令签名 ×次数 ×占比，前 3）｜ 错误类型分布（`运行异常 ×8、编码不一致 ×2`）｜ 采样范围说明
- 建议随事实变：主导失败点 ≥1 个时直接点名该命令，并说明「同一条命令反复失败通常不是命令写错，而是它读写的文件/参数/环境不对」

**踩到并修掉的坑**

1. **SQL 截断导致垃圾签名**：`substr(input,1,400)` 把 JSON 截断 → `JSON.parse` 抛错 → 原本「解析失败就原样返回」，于是签名变成 `{"command":"cd`，还进了问题标题。改为 `extractPayloadLenient()` 正则兜底（识别截断 JSON），截断放宽到 1200 字。
2. **兜底取「第一个字符串值」会把正文当参数**：edit 的 `newText` 是整段正文，长度上限 200 字以内才取，否则返回 null。
3. **续行符独占一段**：`cd "..." && \` + 换行 + `del /q ...` 按 `&&` 切段后 `\` 自成一节，成了 `未知命令`。过滤纯 `\`/`^` 段。
4. `not_an_error`（采集端把正常输出写进 error）从分布里剔除，并在证据里注明「另有 N 条为日志误写，已剔除」，否则失败数与类型分布之和对不上。




### 2026-11-02 · B 第一步：离线 LLM 根因诊断（代码就绪，待跑批）

**为什么要先离线跑一遍再上 UI**：Diagnoser 的输出是"根因判断"，它和错误签名不同——签名错了一眼能看出来，根因错了会被当成真的，然后据此改错地方。所以先在 23 条上做人工验收（≥8/10 才落库上界面），不达标就说明 prompt 或证据不足，继续调，而不是硬上。

**已实现**

- `src/lib/engine/detect/diagnoser.ts`：8 类封闭根因枚举 + `Diagnosis{rootCause,narrative,evidenceRefs,suggestion,confidence}`；输入按优先级裁剪到 8K；解析失败降 temperature=0 重试一次；不依赖 prisma（配置注入，便于 CLI 直接 require）。
- `scripts/diagnose-cli.cjs`：取证 → 并发 3 跑批 → 产出 `.tmp-verify/diagnosis-report.md`（每条带 `- [ ] 对　- [ ] 半对　- [ ] 错`）。
- 模型配置优先级：命令行 `--api-key/--base-url/--model` > 环境变量 `DIAG_LLM_*` > 设置页 activeConfig。余额不足换 key 时不必动数据库。

**证据装配踩到的坑（dry-run 才暴露）**

1. **user span 的正文在 `input`，`output` 恒为空**：原来取 `?.output`，23/23 条「该轮用户诉求」全空。
2. **续跑轮的 user span 只有「继续」「好」**：光有本轮诉求等于没给任务背景，判断不了目标对不对。补 `taskIntent`（会话首条 user span）并加进 prompt。
3. **工具序列可能上百步**：只保留失败前最近 20 步，越近越相关。
4. `errorKind` 原来直接把枚举值填进 `errorKindLabel`，改为走 `ERROR_KIND_LABEL` 中文标签。

**当时的状态**：链路已用本地假 LLM 端到端验证（2 条成功、报告结构正确），真实模型卡在 `deepseek-flash` 余额不足（HTTP 402 Insufficient Balance）。充值或换 key 后直接跑：

```bash
npm run detect:build
node scripts/diagnose-cli.cjs          # 或带 --api-key/--base-url/--model
```

