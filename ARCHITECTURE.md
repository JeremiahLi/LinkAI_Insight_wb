# ARCHITECTURE.md — 系统架构与控制台账

> **本文档的定位**：这是唯一一份「你签收的」架构文档。它的作用是把散落在文件头注释、
> AI 会话记忆里的隐性契约，变成一份你可以审阅、修改、据此下令的显性台账。
> 文中每一句断言都标注了出处（文件路径），你随时可以抽查核对。
>
> **维护规则（签收后生效）**：
> 1. 任何口径类改动（本文第 4 节），改动者必须同步更新对应条目的日期与内容，否则不得提交；
> 2. 新增/删除模块必须在第 2 节登记一行；
> 3. PLAN.md 记录「做了什么」，本文记录「系统现在长什么样」——后者以本文为准。
>
> 最后签收：____（待你审阅后填写日期）
> 生成：2026-11-04，逐条基于当日代码实读，非凭记忆。

---

## 1. 系统一句话定位

**个人自用的 Agent 运维平台**：采集 pi coding agent 的运行轨迹（span），入库后做四层加工——
统计看板（出了什么问题）→ 异常检测（在哪出的）→ 根因诊断（为什么出）→ 实验评测（新版本修没修好）。
对应 PLAN.md 的验收判据：一个不看代码的 Agent 开发者能回答这四个问题。

### 数据流总图

```
┌─ 采集端（部分不在本仓库）──────────────────────────────────────┐
│ pi_extension_capture.ts（本仓库，扩展侧捕获脚本）                  │
│   → upload.cjs（运行时，C:\Users\Lenovo\.linkAI-capture\，不在仓库）│
│     · 消费 session_start span，提升为 payload 顶层               │
│       agentVersion / promptHash / skillSetHash / configHash     │
└──────────────────────┬───────────────────────────────────────┘
                       ↓ POST /api/sessions/upload
┌─ 入口与派生 ──────────────────────────────────────────────────┐
│ upload route：toIntOr 数值收敛 → resolveAgent → derive.ts        │
│   · 反推 Agent 实例名（工作目录众数）                             │
│   · computeOutcome：success / partial / failed / truncated      │
└──────────────────────┬───────────────────────────────────────┘
                       ↓
┌─ 存储 ────────────────────────────────────────────────────────┐
│ prisma/schema.prisma（唯一事实源，276 行）                        │
│ Session / Span / Agent / Project / User / Skill /               │
│ BusinessMetric / Experiment / ExperimentCase / EvalResult /     │
│ UserSettings                                                    │
└──┬───────────────────┬───────────────────┬────────────────────┘
   ↓                   ↓                   ↓
┌─ 统计层 stats/* ─┐ ┌─ 检测层 detect/* ─┐ ┌─ 实验层 experiment/* ─┐
│ 看板聚合/健康分   │ │ 失败链/签名/复发   │ │ 规则评估器 + LLM judge │
│  → 看板页面      │ │  → 运行异常分析    │ │  → 评测中心            │
└──────────────────┘ └────────┬─────────┘ └───────────────────────┘
                              ↓
                   ┌─ 诊断层 diagnose/* ─┐
                   │ L0→L1→L2→L3→L5 五层 │
                   │ 根因 11 类封闭枚举    │
                   │  + remediation 建议  │
                   └─────────────────────┘
```

---

## 2. 模块地图

### 2.1 存储层

| 实体 | 职责 | 需要你知道的点 |
|---|---|---|
| `Session` | 一次 Agent 会话 | `outcome` 是终态唯一权威；`agentVersion: null` = 未上报 ≠ `'1.0.0'`；冗余落列（llmCallCount 等）是为列表页免 JOIN |
| `Span` | 会话内一次调用 | `kind` 分 user / llm_thinking / tool_call / answer / system_prompt；**`startTime` 是 Int Unix 秒**（与 Session 的 DateTime 不同） |
| `Agent/Project/User` | 归属三维 | Agent 实例名 = 工作目录名（derive 反推）；Project.name 是可读目录名（曾错存为 hex id） |
| `Experiment*` 四张表 | 评测中心 | case 可来自会话抽取或手工；EvalResult 按 (caseId, evaluatorId) 唯一 |
| `Skill / BusinessMetric / UserSettings` | 辅助 | Skill 有 contentHash 做同步去重 |

### 2.2 入口层（API 路由，按职责分组）

| 组 | 路由 | 职责 |
|---|---|---|
| 上传 | `POST /api/sessions/upload` | 唯一数据入口；数值字段 toIntOr 收敛、非法回退 0；agentName/projectName/agentVersion 顶层字段支持 |
| 会话 | `/api/sessions`（列表/board/top/by-tag）、`[sessionId]`、`tree` | 列表与 trace 树 |
| Agent | `/api/agents`、`[name]`、`issues`、`recurrence` | 看板、详情、**运行异常分析**、症状复发 |
| 统计看板 | `/api/dashboard/overview`、`agents/*`、`users/*`、`/api/stats`、`/api/llm/board` | 各看板页的数据源 |
| 技能 | `/api/skills`（sync/stats/board/[name]/usage） | Skill 同步与使用统计 |
| 评测 | `/api/experiments`（CRUD/cases/run/results/compare/sessions）、`/api/evaluators` | 实验全生命周期；evaluator 元数据透出 |
| 业务指标 | `/api/biz-metrics/upload`、`stats` | 独立的业务侧 ground truth 上报 |
| 设置 | `/api/settings`、`settings/test` | LLM 配置与连通性测试 |

### 2.3 派生层

| 文件 | 职责 |
|---|---|
| `src/lib/engine/ingest/derive.ts`（202 行，纯函数） | 入库派生：反推 Agent 实例名（tool_call input 里的 `.pi/skills` 锚点与 cd 命令，取 cwd 众数）、可读 Project.name、computeOutcome 三态+truncated 判定（partial 只认**未自愈**的失败，依赖 failure-chain） |

### 2.4 统计层（src/lib/engine/stats/，14 文件）

| 文件 | 职责 | 备注 |
|---|---|---|
| `session-outcome.ts` | **会话成败口径唯一来源**（SQL_FINISHED/BAD/PARTIAL/TRUNCATED） | 新统计禁止另写口径 |
| `health.ts` | 四维健康分（稳定 0.4/活跃 0.25/效率 0.2/成本 0.15）+ successRateOf | 窗口固定 30 天；效率/成本用自身历史基线；健康分 ≠ 质量分 |
| `anomalies.ts` | 概览页二值异常阈值（错误率 0.3、最少 2 会话） | 仅 /api/stats 用；看板改用健康分 |
| `overview.ts` | 首页四张全局趋势图 | 按天聚合，缺失日补 0 |
| `agent-board.ts` / `agent-detail.ts` | Agent 列表 / 下钻（含统计聚合级 issues） | 与 detect 层的过程级分析**并存不互替** |
| `session-board.ts`（859 行） | 会话列表看板 | |
| `skill-tool-board.ts`（890 行） | /skills 页：工具失败聚类 + Skill 使用 | |
| `llm-board.ts` / `user-board.ts` / `user-drilldown.ts` / `user-compare.ts` | LLM / 用户维度看板 | |
| `trend.ts` | 日/周趋势（复用 SQL_BAD 口径） | |
| `range.ts` | 时间窗归一化公共件 | 所有看板时间过滤用 **Session.startTime**，不用 Span.createdAt |

### 2.5 检测层（src/lib/engine/detect/，7 文件，全部纯函数可单测）

| 文件 | 职责 |
|---|---|
| `error-signature.ts`（431 行） | L0：自由文本 error → 13 类签名 `{kind,key,family,...}`；garbled（U+FFFD）是独立标志不放弃归类；not_an_error（日志误写）单独剔除 |
| `failure-chain.ts`（234 行） | L1：孤立失败 → 「失败→重试→结局」链，结局 5 种（retried_recovered 等）。**存在理由：实测 84% 工具失败是自愈的**，severity 必须由结局决定 |
| `remediation.ts`（196 行） | 确定性修复建议：ErrorSignature → 根因假设 + 动作 + confidence，不调 LLM、不编造 |
| `command-stats.ts`（413 行） | 接口级成败对照（「bash 26% 失败」拆到「python merge.py 53%，入参与成功样本一致→问题在数据」）。**铁律：禁止 normalizeToolName 合并接口**（edit/write/edit_file 入参结构不同，混桶产生假结论） |
| `recurrence.ts`（203 行） | 症状复发统计。触发率分母 = 该工具该周调用次数（不是会话数）；「本周期没出现」≠「修好了」 |
| `diagnoser.ts`（336 行） | L3：规则判不了的交 LLM；含 8K 证据裁剪、降级重试 |
| `agent-failures.ts`（287 行） | IO 聚合层：接库、跑检测器、产出 DTO（唯一依赖 prisma 的检测层文件） |

### 2.6 诊断层（src/lib/engine/diagnose/，五层管线）

```
L0 error-signature    正则特征，确定性
L1 失败链 + producers  产物 ← 生产者回溯（diagnose-cli.cjs 组装）
L2 l2-rules.ts(440行)  规则可判定的当场定死（9 类判据），纯函数
L3 diagnoser.ts        只处理 L2 判不了的，LLM 兜底
L5 l5-verify.ts(130行) 门禁：枚举合法 / 证据逐字可寻 / 归因可修
                       任一不过 → 降级或驳回
root-cause.ts(116行)   根因枚举**唯一来源**（11 类，2026-11-03 由 8 类重构）
```

11 类根因（详见 root-cause.ts，含中文标签）：schema_violation（最高频）、encoding_corruption、
input_truncation、tool_arg_error、tool_env_error、requirement_ambiguity（收紧准入）、
hallucination（收紧为「断言在材料中找不到」）等。
重构依据：2026-11-02 人工标注 19 条，旧 8 类严格准确率仅 31.6%，错的全集中在两个桶。

### 2.7 实验评测层（src/lib/engine/experiment/，8 文件）

| 文件 | 职责 |
|---|---|
| `evaluator-types.ts` | Detector/Diagnoser/Scorer 的接口定义 |
| `evaluators.ts`（444 行）+ `rule-evaluators.ts`（359 行） | 7 个规则评估器（确定性） |
| `judge-llm.ts` / `judge-assembly.ts` | 6 个 LLM judge 与证据装配 |
| `session-data.ts` | 用例抽取：**末条非空 answer**、多轮按轮拆 case（M0.1，2026-11-04 修正） |
| `run-experiment.ts` / `detail-agg.ts` | 实验执行与结果聚合 |

### 2.8 前端页面（src/app/(main)/）

| 页面 | 数据源 | 你常用程度（预判，待你修正） |
|---|---|---|
| `trace/[traceId]` | 会话树 API | ★★★ 日常排查主入口 |
| `agent-board` / `agent-board/[name]` | agent-board/detail/issues/recurrence | ★★★ |
| `experiments` 全套 | experiments API | ★★ 版本验证用 |
| `page.tsx`（首页）/ `llm` / `user-stats` / `skill-stats` / `skills` | overview/llm-board 等 | ★（个人使用可能偏低，见第 6 节） |
| `settings` | settings API | ★★ LLM key 配置 |

---

## 3. 模块依赖关系（谁动了会波及谁）

```
schema.prisma ──► upload route ──► derive.ts ──► 库
                                      │
        ┌─────────────────────────────┼──────────────────────┐
        ↓                             ↓                      ↓
   stats/*（只读聚合）          detect/*（纯函数）        experiment/*
        │                             │                      │
   看板页面                    agent-failures（IO）        评测中心
                                      │
                              diagnose/*（L2/L5 依赖 root-cause）
                                      │
                              remediation（只依赖 error-signature）
```

**波及面要点**：
- 改 `root-cause.ts` 枚举 → L2 规则、L3 提示词、L5 门禁、前端标签全要跟（这就是它写成唯一来源的原因）。
- 改 derive.ts 的 outcome/归属规则 → **必须同步 `scripts/backfill-sessions.cjs`**（两份同逻辑，脚本是 CJS 无法 import TS）。
- 改 schema → `prisma db push --skip-generate` + `prisma generate`；Turbopack 会把 client 外部化为 `@prisma/client-<hash>`，重装依赖可能清掉它（全部 API 500 的经典根因）。
- `prisma/dev.db` 已移出版本库（2026-11-03），勿再 git add。

---

## 4. 口径决策台账（改动必须回写本节）

| # | 决策 | 唯一出处 | 定版日期 |
|---|---|---|---|
| D1 | 会话终态只看 `Session.outcome`：success/partial/failed/truncated/''；**禁止 errorCount>0 判失败**（降级为过程失败次数） | `stats/session-outcome.ts` + `derive.computeOutcome` | 2026-10-22，2026-11-04 扩 truncated |
| D2 | 成功率 = `(1-(bad+partial*0.5)/finished)*100`；partial 记半失败；空 outcome 回退旧口径（errorCount>0）保回填前看板不跳变 | `health.ts:successRateOf` + session-outcome.ts | 2026-10-22 |
| D3 | truncated（末轮无输出但此前有交付）暂按 failed 计分母，详情页单独标注，**观察两周后再定去留** | session-outcome.ts | 2026-11-04 |
| D4 | partial 只认**未自愈**失败：failure-chain 判 retried_recovered 的不计（实测修正 8.4pp 低估） | derive.ts | 2026-11-04 |
| D5 | Agent 实例名 = 工作目录名（cwd 众数，outputs/dist 子目录回退上一级）；改规则必须同步 backfill 脚本 | derive.ts + scripts/backfill-sessions.cjs | 2026-10-22 |
| D6 | agentVersion：null=未上报 ≠ '1.0.0'；update 分支不得覆盖已存值 | schema.prisma 注释 + upload route | 2026-11-03 |
| D7 | 上传契约：session_start 被采集端消费提升为顶层字段；数值一律 toIntOr，非法回退 0 | upload.cjs（不在仓库）+ upload route | 2026-10 |
| D8 | Span.startTime 是 Int Unix 秒；按毫秒过滤会静默得空集 | schema.prisma | 2026-11-02 踩坑确认 |
| D9 | 看板时间过滤一律 Session.startTime（发生时间），不用 Span.createdAt（入库时间） | skill-tool-board.ts 头部 | — |
| D10 | 工具失败 severity 由失败链**结局**决定，不由「有无报错」决定；not_an_error（日志误写）剔除 | failure-chain.ts | 2026-11-02 |
| D11 | 检测器分桶禁止 normalizeToolName 合并接口（edit/write/edit_file 入参结构不同） | command-stats.ts + PLAN.md 执行日志 | 2026-11-02 |
| D12 | 健康分四维权重固定；效率/成本用自身历史基线（跨 framework 绝对阈值无信息量）；成本用 input+output 不用 totalTokens；窗口固定 30 天；sessions=0 返回 null | health.ts 头部 | — |
| D13 | 根因枚举 11 类，root-cause.ts 是唯一来源；requirement_ambiguity 须有轨迹证据，禁止「用户没写清」当理由 | root-cause.ts | 2026-11-03 |
| D14 | 复发触发率分母 = 工具该周调用次数；「没出现」≠「修好了」 | recurrence.ts | — |
| D15 | toolCallCount 含 command；agent-board.toolCalls 只算 tool_call（历史遗留差异，已在 schema 注释声明） | schema.prisma 注释 | — |
| D16 | L5 门禁：证据须逐字可寻，编造即驳回；置信度 <0.5 降级 | l5-verify.ts | 2026-11-03 |

---

## 5. 已做 / 未做 / 半做（对照 PLAN.md 里程碑）

### ✅ 已完成

| 项 | 落点 | 完成日 |
|---|---|---|
| M0.1 用例抽取口径（末条非空 answer、按轮拆 case） | experiment/session-data.ts | 2026-11-04 |
| M0.2 版本快照落列（update 不覆盖） | upload route | 2026-11-03 |
| M0.5 truncated 假失败终态 | derive.ts + session-outcome.ts | 2026-11-04 |
| B1/B2 检测器链：签名/失败链/建议 + CLI | detect/* + analyze-agent.cjs | 2026-11-02 |
| B3.5 接口级成败对照 | command-stats.ts | 2026-11-02 |
| 诊断五层 L0-L5 + 根因 11 类重构 | diagnose/* | 2026-11-03 |
| L2 规则层实测：同批标注 17 对/2 半对/0 错（⚠️ 有虚高风险，见第 6 节） | l2-rules.ts | 2026-11-03 |
| UI：运行异常分析面板 + issues/recurrence API | failure-analysis-panel.tsx 等 | 2026-11-02 |
| 会话回填脚本（dry-run/--apply，幂等） | backfill-sessions.cjs | 2026-10 |
| 评测中心：7 规则评估器 + 6 LLM judge + 实验全流程 | experiment/* + api/experiments | 2026-10 |
| dev.db 移出版本库（key 泄漏风险消除） | .gitignore + db:reset | 2026-11-03 |

### ⚠️ 半做

| 项 | 现状 | 缺口 |
|---|---|---|
| M0.3 采集端版本契约 | 服务端支持顶层 agentVersion/promptHash | 采集端 `.pi/agent.json` 需逐 Agent 写 version；**历史数据不可回填**，全库覆盖率≈0 |
| 误报治理（M1.3 allowlist） | 只有 not_an_error 剔除 + garbled 标志 | 无配置化预期失败白名单（grep 非零、测试失败等） |
| Issue 实体（M1.4） | 本库 issues 是**即时计算**，不落库 | 无 Issue model → 无「标记已修/fixedInVersion」生命周期 |

### ❌ 未做（按 PLAN 优先级）

| 项 | 说明 | 前置 |
|---|---|---|
| M0.4 数据体检脚本 data-health.cjs | answer 空值率/outcome 分布基线报告 | 无，半天可做 |
| M2 回归集自生长 | Finding→Case、srcIssueId、轨迹快照固化 | Issue 实体 |
| M3 版本验证与门禁 | Release 表、版本切片、门禁判定 | agentVersion 覆盖率（当前≈0，**空转风险高**） |
| M4 告警与用户信号 | SessionFeedback、发布劣化检测、推送 | 无强依赖 |
| **测试（PLAN 之外，本档案新增）** | 全库**零自动化测试**；仅 detect:build 编译验证 | 无 |

---

## 6. 已知缺口与风险（按危害排序）

1. **零测试**。口径层（D1-D4）、失败链、L2 规则全是纯函数却无单测——每次 AI 重构你都只能肉眼验证，这是失控感的物理根源。三个最小测试即可改善：outcome 判定样例集、failure-chain 自愈/致命样例、root-cause 枚举↔L2 映射。
2. **agentVersion 覆盖率≈0** → M3 版本验证整条线空转，除非先补采集端。
3. **L2 规则准确率在同批数据上验证**（规则是对着那 19 条标注写的），真实准确率必须用新采集会话复验。
4. **judge 一致率未达标**（严格 31.6%）：版本对比目前只认规则层结论，LLM judge 输出只作分诊。
5. **数据先天缺陷**：25.8% 错误文本编码损坏（可分类不可读）；exit_code 类 63 条无法归因；26.3% answer 为空（M0.1 已修抽取端，源头仍缺）。
6. **双分叉**：本仓库（端口 3010）是权威主线；`AgentOps-Cursor`（端口 3002，独立 dev.db/git）有 Release+Issue 持久化雏形但**问题状态机停滞在 candidate**。合并其能力时不可照抄状态查询（`status in (open,confirmed,fixed)` 查不出东西）。
7. **疑似过剩**：user-stats/skill-stats/skills/llm 四组看板面向多用户多 Agent 运营，个人自用价值存疑——是否砍掉由你定（砍是控制权的行使）。

---

## 7. 快速核查命令

```bash
npm run dev                    # 3010 端口起服务
npm run detect:build           # 编译检测/诊断模块到 .tmp-verify（类型检查即验证）
npm run detect:analyze -- <agentName|all> <days>   # 异常排行 + 接口级成败对照
npm run detect:diagnose        # LLM 根因跑批（key 在 .env，缓存于 diagnosis-cache.json）
node scripts/backfill-sessions.cjs [--apply]       # 会话回填（先 dry-run）
NODE_OPTIONS= ./node_modules/.bin/prisma db push --skip-generate   # schema 变更后
```

---

## 8. 你需要掌握的五个契约（控制权清单）

按投入产出排序，每项的验收标准是「能不看文档复述」：

1. **schema.prisma**（半天）——三个实体 + 每个冗余列为什么存在；
2. **上传契约**（D7/D8）——session_start 被消费、toIntOr、时间字段双口径；
3. **口径层**（D1-D4）——outcome 四态 + successRateOf；
4. **诊断五层**（2.6 节）——每层解决什么、为什么 L2 能定就不问 LLM；
5. **derive 归属规则**（D5）——及其与 backfill 脚本的双写义务。

**不需要掌握**：Turbopack/Prisma 内部机制（记环境坑即可）、trace 前端可视化实现、
离线包打包流程、各 stats board 具体 SQL、judge prompt 细节。
