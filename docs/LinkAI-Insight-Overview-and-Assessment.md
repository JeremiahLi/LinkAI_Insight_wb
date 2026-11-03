# LinkAI Insight · 项目介绍与业界对标评估

> 评估对象：`E:\lijian\Job\202610\AgentOps\SourceCode`（git `JeremiahLi/LinkAI_Insight_wb`，59 次提交，末次 2026-11-02 20:14）
> 数据基准：`prisma/dev.db`（44 MB，2026-11-03 11:14 快照），243 会话 / 10,206 span，时间跨度 2026-07-23 ~ 2026-10-29
> 评估日期：2026-11-03

---

## 一、结论摘要

**这不是一个 AgentOps 平台，而是一个单人自用的 Agent 运行分析工作台。** 它的真实资产不在那 17 个看板页面里，而在 `src/lib/engine/detect/` 那套失败语义层——把「工具报错了」推进到「这一次是怎么失败的、自愈没有、根因在哪、改哪一行」。这一层主流商业产品**默认不做**，是它唯一有对外价值的部分。

三条硬判断：

| # | 判断 | 证据 |
|---|---|---|
| 1 | 差异化真实存在，且不是包装出来的 | 命令级成败对照（同命令同参数一次成一次败 → 问题不在命令）、失败因果链（84% 工具失败重试自愈）、症状跨周复发。三者都建立在本库实测数据上，不是通用模板 |
| 2 | **指标层自相矛盾**：成功率被系统性低估约 8.4 个百分点 | 现状 76.3%（18 failed + 68 partial×0.5 / 219）；复算显示 68 个 partial 里有 37 个（54%）工具失败全部同轮自愈，按「自愈不算失败」应记 success → 84.7%。而 `failure-chain` 这个判断能力已经写好，却没接回 `outcome` |
| 3 | 「版本验证」这条主线目前是空的 | `agentVersion` 覆盖率 **0/243**，`promptHash` **0/243**，`session_start` span 全库 0 条。没有版本维度，Release 对比、发布门禁、回归判定全部无从谈起 |

**方向判断：继续投「检测 → 诊断 → 可行动建议」是对的；继续扩看板、扩评估器是错的。** 前者是别处买不到的，后者是 Langfuse / LangSmith / Braintrust 已经做了五年且做得更好的。

---

## 二、项目事实（可核验）

### 2.1 规模

| 维度 | 数值 |
|---|---|
| TypeScript/TSX 源文件 | 145 个，28,330 行 |
| API 路由（`src/app/api/**/route.ts`） | 40 个 |
| 页面（`app/(main)`） | 17 个 |
| 采集端扩展 | `pi-extensions捕获脚本/pi_extension_capture.ts`，699 行（运行时另有 `C:\Users\Lenovo\.linkAI-capture\upload.cjs`，**不在仓库内**） |
| 测试 / Lint | **0 个测试文件，无 ESLint 配置** |

### 2.2 技术栈

Next.js 16.2.10（App Router + Turbopack + React Compiler）· React 19.2 · TypeScript 5 · Tailwind 4 + shadcn/base-ui · Prisma 5.22 + **SQLite** · Recharts 3 · next-themes。

### 2.3 实际数据分布

| 表 | 行数 | 说明 |
|---|---|---|
| Session | 243 | success 133 / partial 68 / failed 18 / 空 24 |
| Span | 10,206 | tool_call 4,883 · llm_thinking 3,073 · answer 851 · user 699 · system_prompt 696 · turn_start 4 |
| Agent | 26 | 仅 14 个有会话；`pi-coding-agent` 兜底记录独占 65 个 |
| Project | 47 | 名称为工作目录名（`derive.ts` 反推） |
| User | 7 | 实际单一真实用户 |
| Skill | 42 | 仅元数据 + contentHash |
| BusinessMetric | **0** | 采集 SDK 已写，无人使用 |
| Experiment / Case / EvalResult | 4 / 6 / 33 | 全部是「评估测试1」「测试2」这类提交前自测数据，19 done / 8 failed / 6 pending |

### 2.4 五层数据流

```
① 采集   pi_extension_capture.ts (699行)  →  upload.cjs (仓库外)  →  POST /api/sessions/upload
② 入库   derive.ts: 终态三态 / 标题 / Agent 名四级兜底 / 工作目录反推 / 父子会话时间窗匹配
③ 口径   session-outcome.ts（SQL_FINISHED/BAD/PARTIAL 唯一来源）+ health.ts:successRateOf
④ 检测   detect/{error-signature, failure-chain, remediation, command-stats, recurrence, diagnoser}
⑤ 评测   experiment/{evaluators(6 LLM), rule-evaluators(7 规则), judge-llm, run-experiment}
         → 呈现：概览 / 用户 / Agent / Session+Trace / LLM / Tool&Skill / 评测 / 设置
```

---

## 三、值得记录的七个设计取舍

这些不是「功能」，是踩过坑之后写下来的判断，也是这个项目最有复用价值的部分。

1. **会话终态三态，而不是 `errorCount > 0`。** 一次质检回流后有交付的会话，按旧口径被判失败。现在只看「末条 answer 有没有交付」：success / partial / failed / 空。
2. **严重度由结局决定，不由「有没有报错」决定。** 349 条工具错误 → 281 条失败链 → 237 条（84%）重试自愈。按错误 span 数排名会把问题夸大约 10 倍。
3. **接口级成败对照，且禁止合并工具别名。** 最初把 `edit` / `edit_file` / `write` 归为 `edit`，立刻产出假结论：`edit 42-table.json` 的「成功样本」其实来自 `write`，入参结构完全不同。库里 `write` 856 次、`edit_file` 634 次、`edit` 457 次，混桶即失真。
4. **健康分四维、用自身历史基线。** 跨框架绝对阈值不可用（编码类 P95 509s vs 业务类 4.4~7.6s，差 70~110 倍）。成本只用 input+output，**不用 totalTokens**（pi 每轮 cacheRead 是 input 的 10 倍，用总量等于惩罚「上下文复用得好」的 Agent）。
5. **`sessions === 0` 返回 null，不打 0 分。** 「未使用」不是「不健康」。
6. **症状复发的分母是「该工具该周调用次数」，不是会话数。** 一个会话可以调 46 次 bash，用会话数做分母会严重低估触发率。且必须显示分母——「这周没出现」不等于「修好了」。
7. **拿不到的字段一律记 null，不回填、不默认 `1.0.0`。** 旧实现把缺失版本写成 `1.0.0`，把人工录入的 2.0.0 / 1.2.0 全冲掉，等于版本维度整列假数据。现在 `agentVersion=null` 明确表示「未上报」。

---

## 四、与业界主流对标

对标对象取 2026 年实际在用的六类：LangSmith、Langfuse、Arize Phoenix、Braintrust、Datadog LLM Observability、Helicone。

### 4.1 能力对照

| 维度 | 本项目 | 业界主流（2026） |
|---|---|---|
| 接入方式 | 自研 upload 契约（HTTP JSON），采集器强绑定 pi 扩展 | **OpenTelemetry GenAI 语义约定 / OpenInference**，Langfuse 3.x 已按 OTel 重建摄取接口；Datadog v1.37 起原生支持 `gen_ai.*` |
| 标准状态 | 私有契约，无版本号 | OTel GenAI 仍为 **Development**（2026-10 已迁至独立仓库且无 tag），但已是事实共识；Datadog / Honeycomb / New Relic / Grafana 均可直接消费 |
| Trace 模型 | Session + 扁平 Span（parentId/branchId 存在但基本不用） | 层级 trace + span 树；`invoke_agent` → `chat` / `execute_tool` 标准 span 命名 |
| 存储 | SQLite 单文件 44 MB，单写 | ClickHouse / Postgres 列存，Langfuse 号称 90B+ 观测/月 |
| 评测 | 6 个 LLM judge + 7 个规则评估器（精确/包含/模糊/正则/JSON Schema/工具序列/阈值） | 评测是 2026 年的**分水岭能力**：scorer 库、数据集、人工标注、在线评估；Braintrust / LangSmith 领先，Phoenix 强在评测严格性 |
| 回归闭环 | 无 Issue / Release 实体；实验靠手工建用例 | 数据集 + 实验 + **CI 门禁**（Braintrust 原生 GitHub Action、LangSmith `evaluate()`、Langfuse 程序化 dataset run） |
| 告警 | 侧栏有「告警中心」入口，**页面不存在（404）** | 阈值 + 异常检测 + 通知通道，标配 |
| 成本 | 分 token 类型统计，不折算货币 | 按 provider 价目表折算金额、按 trace/功能归因、预算告警 |
| 多租户 / 权限 | **无任何鉴权**（无 middleware、无 token 校验，40 个 API 全裸） | RBAC / SSO / 项目隔离，自托管版亦具备 |
| 部署形态 | 单机 dev server + 手工离线包 | Cloud / Docker / K8s / Terraform |
| 独有能力 | **失败语义层**：错误签名 13 类、失败因果链、命令级成败差集、跨周症状复发、确定性修复建议 | 上述产品在此处**只到「工具失败率」粒度**，不下钻到「同一条命令的失败/成功入参差在哪」 |

### 4.2 位置判定

按「接入标准度 × 闭环完整度」两轴，本项目落在**自建工具链的下象限偏右**：闭环里唯一真正打通的是「发现异常」（检测层），「定位 → 归因 → 验证修复」三段缺失或空转。

这与它的出身一致：它是为一个内部 coding agent 排障而长出来的，不是为多团队交付设计的。

---

## 五、优势

1. **失败语义层是真差异，不是自嗨。** 归因单位从「工具名 + 失败率」下沉到「命令签名 + 成败入参差集 + 结局」。实测例子：`read qc_report.txt` 失败用 `/tmp/...`、成功用 `E:\...` —— 这一条直接可转成「不要生成 WSL 风格路径」的规则。主流产品给不出这句话。
2. **口径被强制收敛到唯一实现。** `SQL_FINISHED/BAD/PARTIAL` 与 `successRateOf()` 是全站唯一来源，避免了「看板 96%、下钻 91%」这类经典撕裂。这在自研系统里相当少见。
3. **纯函数 + prisma 注入的分层意识。** `detect/*` 与 `health.ts` 不依赖 IO，可直接被 CLI（`analyze-agent.cjs` / `diagnose-cli.cjs`）复用，也能单测。API 4~45ms 响应，无 LLM 常驻成本。
4. **每个数字都带「为什么这么定」的注释。** 阈值来自实测分布（97/93 分档来自全站配色与 70% 异常线），不是拍脑袋。这类注释密度在当前代码库里是资产，迁移时别丢。

---

## 六、劣势（按影响排序）

### A. 度量可信度（最严重：会让所有上层结论失真）

| 问题 | 证据 | 影响 |
|---|---|---|
| partial 把自愈重试当半失败 | 68 个 partial 中 37 个（54%）工具失败全部同轮自愈；8 个 partial 无工具失败（失败在 answer/llm_thinking 级） | 成功率 76.3% 实为 ~84.7%，**低估 8.4pp**；健康分稳定性维度按 70% 锚点给 20~30 分，多数 Agent 被判 C/D，驱动力是口径而非质量 |
| 样本量不足却给出评分 | 健康分 `MIN_SESSIONS = 2`；26 个 Agent 中 12 个零会话，7 个只有 1~2 个会话 | n=2 的 A/B/C/D 等级没有统计意义，但 UI 上与其他 Agent 同权展示 |
| 阈值全部手工指定 | `GRADE_CUTS`、`SESSION_RATE_ANCHORS`、`RATIO_ANCHORS` 均为经验值 | 换个 Agent 族群（如 langgraph 业务流）就失效，且无人知道失效了 |
| 概览错误序列与看板口径不同源 | `overview.ts` 用 `s.status = 'error'`，未走 `SQL_BAD` | 历史数据（`outcome=''` 且 `errorCount>0`）在两处数字不一致 |

### B. 数据完整性（决定了「版本」这条主线能不能开工）

- `agentVersion` **0/243**、`promptHash` **0/243**、`session_start` span **0 条**。`PLAN.md` M0.3 定为「唯一跨团队阻塞点」，至今未解。
- `answer` span 空输出率 26.3%（224/851）；18 个 failed 会话末条 answer 全空，其中 9 个此前有非空交付 → 「真失败」与「采集端补写空 answer」不可区分。
- `Span.error` 实际写的是工具输出（`s.isError ? s.output : null`），导致 25.8%（90 条）error 文本含 U+FFFD 乱码，摘要不可读；另有 63 条 `exit_code` 类只能拿到退出码，无法归因。
- 采集器运行时 `upload.cjs` **不在仓库内**，任何契约变更都要人工找文件改，且无法 code review。

### C. 接入与生态

- 私有 upload 契约：每加一个 Agent 框架（Claude Code / Codex / LangGraph）都要写一遍适配，而业界已经把 `gen_ai.*` 作为公共接口。**这是最大的长期成本项。**
- 自建 trace UI（Gantt / 转录 / 缩放 / 泳道）约 3,000 行，与 Langfuse/Phoenix 的功能重合度估计 70%+，维护成本全部自己承担。

### D. 评测中心有效性

- 13 个评估器**从未与人工标注做过一致率校准**。`PLAN.md` 自己写了「judge 与人工一致率 < 70% 则分数不可用于版本对比」，该验收未执行。
- `Experiment` 表无 `judgeModel` 快照字段，换模型后新旧分数直接可比 —— 这是会静默产出错误结论的设计缺陷。
- 8/33 结果 `failed`（24%），无重试退避策略；`runExperiment` 是 fire-and-forget，靠 10 分钟空闲阈值回收，进程重启即中断。
- 4 个实验全是自测数据，等于**评测模块从未被真实使用验证**。

### E. 工程质量

- 无测试、无 lint 配置。核心检测器号称纯函数可测，实际零覆盖。
- **无鉴权**：40 个 API 无 token 校验，`/api/sessions/[id]` 可读全部 prompt 与工具入参。局域网内任何人可读、可写（upload 只校验三个 id 非空）。
- API Key 以明文存于 `UserSettings.settingsJson`（SQLite，且 `dev.db` 被 git 跟踪的历史里可能已留存）。
- `dev.db`（44 MB）与 `.bak` 文件在仓库内，git 体积随时间膨胀。
- README 已过期：端口写 3002（实际 3010）、列了不存在的 `/alerts` 与 `/skill-stats`、API 表与实际 40 个路由不一致。

---

## 七、未做但高价值场景（按投入产出排序）

### P0-1 把「自愈重试」从 partial 里摘出来（0.5 人日）

- **问题**：已有 `failure-chain` 能判 `retried_recovered`，但 `computeOutcome` 仍按「有 failed span 即 partial」。
- **做法**：`partial` 拆分 `partial_recovered` / `partial_unrecovered`；`successRateOf` 只对后者计 0.5。
- **收益**：一次性修正 8.4pp 的系统性偏差，且让健康分回到「质量」而不是「口径」。
- **判据**：全站成功率落在 84~86%；37 个自愈会话在详情页标注「过程有失败，已自愈」。
- **风险**：历史趋势断裂 → 作为新值引入，不覆盖旧值，图例标注生效日期。

### P0-2 Issue 实体与 fingerprint 生命周期（3~4 人日）

- **问题**：166 个失败家族里 40 个跨 ≥2 会话、20 个跨 ≥2 周复发，但系统无法回答「上个月不是修好了吗」。
- **做法**：`Issue(agentId, fingerprint, status, fixedInVersion, occurrences, lastSeenAt)` + `PATCH /api/issues/[id]`；`recompute` 按 fingerprint upsert 累加。
- **收益**：把「每次都能看见」变成「可追踪、可关闭、可验证」；这是运维闭环的缺口第一个。
- **判据**：30 条 Finding 人工复核误报率 ≤ 30%；同一 fingerprint 两次重跑命中同一批会话。
- **前置**：`allowlist`（grep 无匹配、测试非零退出、用户主动中断）必须先做，否则两周内被无视。

### P0-3 版本维度打通（跨仓库，1 人日 + 外部协调）

- **问题**：`agentVersion` 覆盖率 0%，`PLAN.md` 的 M3 全部悬空。
- **做法**：先服务端接 upload 顶层 `agentVersion`（已支持），再由采集端从 `.pi/agent.json` 读取；历史数据不回填，标「未知版本」。
- **收益**：「新版本有没有变差」是这类系统唯一无法被替代的提问。没有它，平台只是事后验尸。
- **判据**：新上传会话 `agentVersion` 非空率 = 采集端上报率，且 ≥ 80%。

### P1-4 发布对比与门禁（3 人日，依赖 P0-3）

规则通过率不低于基线 −2pp / judge 均分不低于 −5 / 基线已修 issue 复发数必须为 0 / 单 case 成本不高于 +30%（warn）。语义是「能不能发」，不是「这版好不好」——后者无法自证。

### P1-5 OTel 出口，而不是继续自建（2~3 人日）

- **做法**：把 `Span` 映射为 `gen_ai.*`（`invoke_agent` / `chat` / `execute_tool`，含 `gen_ai.usage.*`、`tool_success`、`error.type`），加一个 OTLP exporter 双写。
- **收益**：一朝接入 Langfuse / Phoenix / Datadog 生态，采集端不再需要为每个框架写适配；自建 UI 可逐步退役。
- **注意**：GenAI 约定仍是 Development、无 tag，必须记录「按哪份快照实现」，并留私有扩展字段承载本项目特有的失败链信息。
- **判据**：同一会话在 Langfuse 自托管实例中可见完整树，且 token/耗时与本地看板误差 < 2%。

### P1-6 用户信号采集（1 人日，最高性价比的 ground truth）

`POST /api/sessions/[id]/feedback`（有用 / 无用 / 重新提问）+ 自动放弃检测（span 间隔 > 10min 且末轮无 answer）。这是唯一不依赖 judge 的真实标签，也是校准 13 个评估器的唯一办法。当前 0 条。

### P2-7 成本货币化 + 预算告警（1 人日）

按模型价目表把 token 折算成 ¥，按 Agent / 用户 / 项目归因。现在的「每轮 Token」对管理者没有说服力，「这个 Agent 上月烧了 ¥3,200，其中 62% 花在重试」才有。

### P2-8 失败案例检索（2 人日）

同一错误家族的历史处置方式检索（「这个 EACCES 上次是怎么解的」）。当前 `recurrence` 已按 family 聚合，只差一层相似度检索与处置记录沉淀。

### P2-9 跨框架同任务对比（3 人日，实验性）

库里有 pi-coding-agent / claude-code / opencode / hermes / langgraph 五类框架、26 个实例，具备做「同任务不同框架」对照的原始素材。但样本量（每个框架 1~27 会话）远不足以出结论，**现阶段做等于制造假发现**。

### 明确不建议做

| 不做 | 理由 |
|---|---|
| 多租户 / RBAC / SSO | 一个真实用户。抽象成本高于收益，且会拖慢唯一有效的那条线 |
| 全库在线 judge 打分 | token 成本高、噪声大、无人工校准；应先 Detector 分诊 |
| 自建 prompt 管理 / Playground | Langfuse 已做到 MIT 级免费，重造没有胜算 |
| 综合质量分（健康分 × 评测分） | 加权口径无法自证，一旦被当 KPI 必然诱导刷分 |

---

## 八、总评与 30 天建议

**评级：技术判断 A−，产品完整度 C，工程规范 D+，差异化 A。**

- 技术判断高于同类自研项目一个档：它拒绝了几个人人都会踩的坑（errorCount 判失败、totalTokens 算成本、跨框架绝对阈值、别名合并）。
- 产品完整度不足：告警入口 404、评测中心未真用、版本维度为空，「四个问题」里只能回答「出了什么问题」，答不了「新版本有没有修好」。
- 工程规范是明显短板：无测试、无 lint、无鉴权、44 MB 数据库进 git。这些不是技术难度问题，是取舍问题——在只有一个人、且要快速验证假设的阶段，这个取舍可以理解，但**在把它交给第二个人之前必须补齐**（最低：upload 鉴权 + 一个检测器的单测 + dev.db 移出版本库）。

**30 天执行顺序（若只能做三件事）：**

1. P0-1 口径修正（半天）——让所有已上线的数字先变得可信。
2. P0-3 版本打通（一天 + 协调）——解掉唯一的跨团队阻塞，否则后面全是空壳。
3. P0-2 Issue 实体（一周）——把「发现问题」变成「能关闭问题」。

**结论反转条件（出现即应调整战略）：**

- 若接入 OTel 后，Langfuse 自托管版 + 一个 200 行脚本即可复现「命令级成败对照」的 80%，则自建平台的路线应终止，只保留检测器作为独立分析服务。
- 若 30 条 Finding 的人工复核显示误报率 > 50%，说明检测层的价值是幻觉，应回退到「只做 trace 检索」，不再投入诊断。
- 若 90 天内 Agent 数仍 < 10 且会话数 < 500，说明使用面没有扩散，此时任何多租户/告警/权限投入都是负收益。

---

*本文所有数字取自 `prisma/dev.db` 实测与源码静态分析；「37/68 自愈」为近似复算（判据：同轮同工具后续存在成功调用），与 `failure-chain` 的正式判定可能有个位数差异，正式实现应以 `extractFailureChains` 为准。业界对标信息取自 2026-11 公开资料，OTel GenAI 约定处于 Development 状态，采纳前需核对当期快照。*
