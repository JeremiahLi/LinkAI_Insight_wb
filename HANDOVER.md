# Pi Agent Insight 交接文档

> **项目名称**: Pi Agent Insight (LinkAI_Insight)
> **版本**: 0.1.0
> **文档版本**: v1.0
> **最后更新**: 2026-08-25
> **项目状态**: 开发迭代中

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈与架构](#2-技术栈与架构)
3. [环境搭建](#3-环境搭建)
4. [目录结构与代码规范](#4-目录结构与代码规范)
5. [核心业务流程](#5-核心业务流程)
6. [数据流与采集链路](#6-数据流与采集链路)
7. [API 接口说明](#7-api-接口说明)
8. [数据库设计](#8-数据库设计)
9. [部署与运维](#9-部署与运维)
10. [已知问题与 TODO](#10-已知问题与-todo)
11. [交接检查清单](#11-交接检查清单)

---

## 1. 项目概述

### 1.1 项目定位

Pi Agent Insight 是一个 **AI Agent 全生命周期观测与运维平台**，用于监控、分析和评估 AI Agent 的运行状态与性能表现。

### 1.2 目标用户

| 用户角色      | 使用场景                                     |
| ------------- | -------------------------------------------- |
| 开发/运维团队 | 监控 Agent 运行状态，排查异常，分析性能瓶颈  |
| 产品/运营团队 | 分析 Agent 市场整体表现，查看使用趋势        |
| 研发团队      | 追踪开发过程中的效率和质量指标，进行实验评测 |

### 1.3 核心功能

1. **概览仪表盘** — 实时/历史运行状态监控，异常预警
2. **Session 追踪** — 查看单次会话的详细执行过程（Span 树）
3. **Agent 统计** — Agent 调用量、成功率等指标
4. **Skill 统计** — Skill 调用次数排行
5. **业务指标** — 自定义业务性能指标上传与展示
6. **实验评测** — A/B 对比评测，支持 LLM Judge 自动评分（开发中）
7. **设置** — 用户偏好配置

### 1.4 项目状态

- **当前阶段**: 开发迭代中
- **部署状态**: 本地开发，未部署到服务器
- **技术债**: 有一些小问题但不严重
- **潜规则**: 基本没有，代码比较直白

---

## 2. 技术栈与架构

### 2.1 技术选型

| 层级     | 技术         | 版本    | 说明             |
| -------- | ------------ | ------- | ---------------- |
| 前端框架 | Next.js      | 16.2.10 | App Router 模式  |
| UI 库    | React        | 19.2.4  | —               |
| 语言     | TypeScript   | ^5      | —               |
| 样式     | Tailwind CSS | ^4      | 原子化 CSS       |
| UI 组件  | shadcn/ui    | ^4.13.0 | 基于 Radix UI    |
| 图表     | recharts     | ^3.9.2  | 仪表盘图表       |
| ORM      | Prisma       | ^5.22.0 | 数据库访问层     |
| 数据库   | SQLite       | —      | 文件型数据库     |
| 状态管理 | nuqs         | ^2.9.0  | URL 查询参数状态 |
| 图标     | lucide-react | ^1.24.0 | 图标库           |
| 主题     | next-themes  | ^0.4.6  | 暗色/亮色主题    |

### 2.2 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (Next.js App Router)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ 仪表盘    │ │ Trace   │ │ 统计页   │ │ 实验评测  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Routes (Next.js)                       │
│  /api/stats  /api/sessions  /api/skills  /api/experiments   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Prisma ORM                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SQLite Database                          │
│                   (prisma/dev.db)                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 外部依赖

| 服务    | 用途     | 说明                                                        |
| ------- | -------- | ----------------------------------------------------------- |
| LLM API | 实验评测 | 用于 LLM Judge 自动评分（具体 provider 见 evaluators 配置） |

---

## 3. 环境搭建

### 3.1 前置要求

| 工具              | 版本要求 | 说明              |
| ----------------- | -------- | ----------------- |
| Node.js           | >= 18    | 推荐使用 LTS 版本 |
| npm / pnpm / yarn | —       | 包管理器任选      |

### 3.2 从零启动步骤

```bash
# 1. 克隆项目（或解压项目目录）
cd LinkAI_Insight(8.13)

# 2. 安装依赖
npm install

# 3. 初始化数据库
npx prisma migrate dev --name init
# 或者直接推送 schema（如果不需要迁移历史）
npx prisma db push

# 4. 生成 Prisma Client
npx prisma generate

# 5. 导入种子数据（可选）
node prisma/seed.js

# 6. 启动开发服务器
npm run dev
```

### 3.3 启动结果

- 开发服务器运行在: **http://localhost:3002**
- 数据库文件位置: `prisma/dev.db`
- 环境变量配置: `.env` 文件（当前仅 `DATABASE_URL`）

### 3.4 常见问题

| 问题                 | 解决方案                                         |
| -------------------- | ------------------------------------------------ |
| Prisma Client 未生成 | 运行`npx prisma generate`                      |
| 数据库锁定           | 关闭占用 dev.db 的进程，或删除 dev.db 重新初始化 |
| 端口被占用           | 修改`package.json` 中 `-p 3002` 为其他端口   |

---

## 4. 目录结构与代码规范

### 4.1 目录树

```
LinkAI_Insight(8.13)/
├── prisma/                        # 数据库相关
│   ├── schema.prisma              # 数据库模型定义
│   ├── dev.db                     # SQLite 数据库文件
│   └── seed.js                    # 种子数据脚本
│
├── public/                        # 静态资源
│   ├── file.svg
│   ├── globe.svg
│   ├── next.svg
│   ├── vercel.svg
│   └── window.svg
│
├── scripts/                       # 工具脚本
│   ├── agent.json                 # Agent 配置
│   ├── check_db.py                # 数据库检查脚本
│   ├── fix_mock_data.py           # 修复模拟数据
│   ├── fix_seed.py                # 修复种子数据
│   ├── generate-seed.js           # 生成种子数据
│   ├── read-skills.js             # 读取 skills
│   ├── seed-biz-jsonl.cjs         # 导入业务 JSONL 数据
│   ├── seed-biz-metrics.cjs       # 导入业务指标
│   ├── seed_historical_sessions.cjs  # 导入历史 sessions
│   ├── upload-biz.cjs             # 上传业务数据
│   ├── pi-extension-biz-capture.ts  # pi 业务数据捕获扩展
│   ├── pi-extension-doc-gen-test.ts # pi 文档生成测试
│   └── lib/                       # 脚本依赖库
│
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── layout.tsx             # 根布局
│   │   ├── globals.css            # 全局样式
│   │   ├── favicon.ico
│   │   │
│   │   ├── (main)/                # 主应用路由组
│   │   │   ├── layout.tsx         # 主布局（含侧边栏）
│   │   │   ├── page.tsx           # 首页（仪表盘）
│   │   │   ├── agent-stats/       # Agent 统计页
│   │   │   ├── biz-stats/         # 业务指标页
│   │   │   ├── experiments/       # 实验评测页
│   │   │   ├── settings/          # 设置页
│   │   │   ├── skill-stats/       # Skill 统计页
│   │   │   └── trace/             # Session 追踪页
│   │   │
│   │   └── api/                   # API 路由
│   │       ├── agents/            # Agent 相关 API
│   │       ├── biz-metrics/       # 业务指标 API
│   │       ├── experiments/       # 实验评测 API
│   │       ├── sessions/          # Session 相关 API
│   │       ├── settings/          # 设置 API
│   │       ├── skills/            # Skill 相关 API
│   │       └── stats/             # 统计 API
│   │
│   ├── components/                # React 组件
│   │   ├── agent/                 # Agent 相关组件
│   │   ├── shell/                 # 应用外壳（侧边栏、顶栏）
│   │   ├── skill/                 # Skill 相关组件
│   │   ├── trace/                 # Trace 相关组件
│   │   ├── ui/                    # 基础 UI 组件（shadcn/ui）
│   │   └── theme-provider.tsx     # 主题提供者
│   │
│   └── lib/                       # 工具库
│       ├── engine/                # 核心引擎
│       │   └── experiment/        # 实验评测引擎
│       ├── evaluators/            # 评测器
│       ├── format.ts              # 格式化工具
│       ├── mock-data.ts           # 模拟数据
│       ├── skill-utils.ts         # Skill 工具
│       ├── types.ts               # TypeScript 类型定义
│       ├── utils.ts               # 通用工具
│       ├── use-agent-metrics.ts   # Agent 指标 Hook
│       ├── use-chart-colors.ts    # 图表颜色 Hook
│       ├── use-mock-biz-data.ts   # 模拟业务数据 Hook
│       ├── use-mock-dashboard-data.ts  # 模拟仪表盘数据 Hook
│       └── use-skill-metrics.ts   # Skill 指标 Hook
│
├── test-agent/                    # 测试/调试工具
│
├── .env                           # 环境变量
├── .gitignore
├── package.json
├── README.md
└── HANDOVER.md                    # 本文档
```

### 4.2 代码规范

#### 命名规范

| 类型          | 规范                          | 示例                              |
| ------------- | ----------------------------- | --------------------------------- |
| 组件文件      | PascalCase                    | `AgentDetailPanel.tsx`          |
| 工具/函数文件 | camelCase                     | `format.ts`, `utils.ts`       |
| API 路由      | kebab-case 目录 +`route.ts` | `sessions/upload/route.ts`      |
| 类型定义      | PascalCase interface          | `Agent`, `Session`, `Span`  |
| 变量/函数     | camelCase                     | `totalTokens`, `formatNumber` |
| 常量          | UPPER_SNAKE_CASE              | `BATCH_SIZE`                    |

#### 导入别名

- 使用 `@/` 前缀指向 `src/` 目录
- 示例: `import { Button } from "@/components/ui/button"`

#### 样式

- 使用 Tailwind CSS 原子类
- 使用 `cn()` 工具函数合并类名（来自 `@/lib/utils`）
- 主题支持暗色/亮色模式

---

## 5. 核心业务流程

### 5.1 仪表盘

**路径**: `/` (首页)

**功能**:

- 展示核心指标：活跃 Agent 数、Skill 调用次数、Session 总数、Token 消耗
- 支持"今日"和"近7天"两种时间范围切换
- 异常预警：错误 Session、Agent 错误率、Token 消耗异常、活跃度下降
- Top Session 排行、Agent/Skill 使用情况

**数据流**:

```
前端 → GET /api/stats?range=realtime|weekly → Prisma 查询 → 返回统计数据
```

### 5.2 Session 追踪

**路径**: `/trace`

**功能**:

- 列表展示所有 Session
- 点击进入详情页查看 Span 树
- 支持查看每个 Span 的输入/输出/Token/耗时

**数据流**:

```
前端 → GET /api/sessions → 返回 Session 列表
前端 → GET /api/sessions/[sessionId] → 返回 Session 详情 + Span 树
```

### 5.3 Agent 统计

**路径**: `/agent-stats`

**功能**:

- 展示各 Agent 的调用量、成功率
- 点击可查看 Agent 详情

### 5.4 Skill 统计

**路径**: `/skill-stats`

**功能**:

- 展示各 Skill 的调用次数排行
- 支持手动同步 Skill 信息

### 5.5 业务指标

**路径**: `/biz-stats`

**功能**:

- 展示自定义业务性能指标
- 支持通用指标（响应时间、成功率、Token 消耗）和自定义指标

### 5.6 实验评测

**路径**: `/experiments`

**功能**（开发中）:

- 创建实验：选择 Agent、评测集、Evaluator
- 运行评测：自动或手动触发
- 查看结果：LLM Judge 评分、人工复核

---

## 6. 数据流与采集链路

### 6.1 完整数据链路

```
┌─────────────────────────────────────────────────────────────────┐
│                        pi Agent 运行时                           │
│                  (AI Agent 执行引擎)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              pi Extensions 捕获脚本                               │
│  路径: C:\Users\Lenovo\.pi\agent\extensions                      │
│  功能: 订阅 pi 运行时事件，捕获数据到本地 jsonl 文件              │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│  运行时数据 jsonl 文件    │     │  业务数据 jsonl 文件      │
│  (Session/Span 数据)     │     │  (Business Metric 数据)   │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│  运行时数据上传脚本       │     │  业务数据上传脚本         │
│  C:\Users\Lenovo\.pi-   │     │  C:\Users\Lenovo\.pi-   │
│  capture\upload.cjs     │     │  biz-capture\upload-biz  │
│                         │     │  .cjs                    │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Pi Agent Insight 服务端                       │
│                                                                   │
│  POST /api/sessions/upload    ← 运行时数据上传                   │
│  POST /api/biz-metrics/upload ← 业务数据上传                     │
│                                                                   │
│  服务端处理: 解析数据 → 去重 → 存入 SQLite                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      前端查询展示                                 │
│  GET /api/stats           → 仪表盘统计数据                       │
│  GET /api/sessions        → Session 列表                         │
│  GET /api/sessions/[id]   → Session 详情                         │
│  GET /api/skills/stats    → Skill 统计                           │
│  GET /api/agents/stats    → Agent 统计                           │
│  GET /api/biz-metrics/... → 业务指标                             │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 捕获脚本实现逻辑

#### 6.2.1 运行时数据捕获脚本 (pi_extension_capture.ts)

**文件路径**: `C:\Users\Lenovo\.pi\agent\extensions\pi_extension_capture.ts`

**核心机制**: pi 的 Extension 机制允许订阅 pi 运行时发出的各种事件。该脚本通过 `pi.on(eventName, callback)` 订阅事件，在事件触发时将数据写入本地 JSONL 文件。

**订阅的事件及处理**:

| 事件                          | 处理逻辑                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `session_start`             | 写入 session_start 记录，包含 agent_name、agent_id、agent_version、pid                    |
| `session_shutdown`          | 写入 session_shutdown 记录，触发上传，关闭 writer                                         |
| `turn_start`                | 更新当前 turnId                                                                           |
| `before_agent_start`        | 写入 system_prompt 记录，包含系统提示词内容                                               |
| `input`                     | 写入 user 记录（用户提问）；检测`/skill:` 命令，读取 SKILL.md 内容并写入 tool_call 记录 |
| `message_end`               | 解析 assistant 消息，分离 thinking/text/toolCalls，写入 llm_thinking 和 answer 记录       |
| `tool_call`                 | 写入 tool_call 记录（工具调用请求）                                                       |
| `tool_result`               | 写入 tool_call 记录（工具调用结果），检测 skill 加载（通过路径判断）                      |
| `model_select`              | 写入 model_select 记录                                                                    |
| `before_provider_request`   | 记录请求开始时间                                                                          |
| `message_start`             | 记录 assistant 消息开始时间                                                               |
| `tool_execution_start`      | 记录工具执行开始时间                                                                      |
| `tool_execution_end`        | 写入 tool_execution 记录，包含执行耗时                                                    |
| `agent_end`                 | 触发上传                                                                                  |
| `beforeExit/SIGINT/SIGTERM` | 触发上传，关闭 writer                                                                     |

**文件写入机制**:

1. **文件路径生成规则**:

   ```
   {SPOOL_DIR}/{userId}/{projectId}/{yyyy-MM-dd}/pi-{sessionId}-{yyyyMMdd}-{HHmmss}.jsonl
   ```

   - `SPOOL_DIR`: 环境变量 `PI_CAPTURE_SPOOL_DIR` 或默认 `~/.pi-capture`
   - `userId`: 环境变量 `PI_CAPTURE_USER` 或系统用户名
   - `projectId`: 当前工作目录路径的 SHA1 哈希前 16 位
2. **Writer 轮换策略**:

   - 每个 session 对应一个 writer
   - session 切换时：先触发上传当前文件 → 关闭当前 writer → 创建新 writer
   - session 退出时：关闭 writer
3. **写入优化**:

   - 使用异步写入队列 + setTimeout(0) 批量 flush
   - 使用 `fs.createWriteStream` 追加写入
   - 支持 `drain` 事件反压控制

**数据脱敏与截断**:

- **敏感字段脱自动识别**: apiKey、api_key、authorization、token、secret、password 等字段值替换为 `***`
- **字符串截断**: 默认最大长度 4000 字符（可通过 `PI_CAPTURE_MAX_STRING` 环境变量配置）  （注意：这个逻辑可能不合适 因为会截断长内容 ，可以优化成如果太长，分多条json条目保存）
- **工具 I/O 截断**: 工具调用的 input/output 单独配置最大长度（默认 4000，`PI_CAPTURE_MAX_TOOL_IO`）

**触发上传的时机**:

| 触发场景                      | 说明                          |
| ----------------------------- | ----------------------------- |
| `agent_end`                 | Agent 完成一次对话轮次        |
| `session_shutdown`          | Session 退出（quit/reload）   |
| `beforeExit/SIGINT/SIGTERM` | 进程退出前                    |
| 定时扫描 (每 30 秒)           | 补传 triggerUpload 漏掉的数据 |

#### 6.2.2 业务数据捕获脚本 (pi-extension-biz-capture.ts)

**文件路径**: `C:\Users\Lenovo\.pi\agent\extensions\pi-extension-biz-capture.ts`

**核心机制**: 与运行时数据捕获类似，但只关注业务指标数据。

**订阅的事件**:

| 事件                          | 处理逻辑                                  |
| ----------------------------- | ----------------------------------------- |
| `agent_end`                 | 触发上传                                  |
| `session_shutdown`          | 触发上传，退出时清理定时器                |
| `beforeExit/SIGINT/SIGTERM` | 触发上传，清理定时器                      |
| 定时器 (每 10 分钟)           | 定期扫描并上传所有未处理的 biz jsonl 文件 |

**与运行时数据捕获的区别**:

- 不写入数据，只触发上传（数据由外部系统写入 jsonl 文件）
- 使用独立的 SPOOL_DIR: `~/.pi-biz-capture`
- 定时扫描间隔更长（10 分钟 vs 30 秒）

### 6.3 上传脚本实现逻辑

#### 6.3.1 运行时数据上传脚本 (upload.cjs)

**文件路径**: `C:\Users\Lenovo\.pi-capture\upload.cjs`

**运行方式**:

```bash
# 单文件上传
node upload.cjs <jsonl文件路径> <后端URL>

# 全量扫描上传
node upload.cjs --scan-all <后端URL>
```

**核心流程**:

```
1. 获取锁（防止并发上传）
2. 读取 JSONL 文件
3. 合并 tool_execution 到对应的 tool_call
4. 构建 Session Payload
5. 计算签名，检查 checkpoint（去重）
6. 检查 pi 进程是否存活
7. POST 上传到服务端
8. 更新 checkpoint
9. 释放锁
```

**JSONL 文件扫描规则**:

- 根据文件名中的 sessionId 查找所有相关文件
- 文件命名规则: `pi-{sessionId}-{yyyyMMdd}-{HHmmss}.jsonl`
- 扫描同一 projectId 目录下的所有日期子目录
- 合并同一 sessionId 的所有记录，按时间排序

**tool_execution 合并逻辑**:

- 通过 `toolCallId` 匹配 `tool_call` 和 `tool_execution` 记录
- 将 `tool_execution` 中的 `duration` 和 `isError` 合并到对应的 `tool_call` 记录中
- 合并后移除 `tool_execution` 记录，只保留完整的 `tool_call`

**buildSessionPayload 转换规则**:

| JSONL kind           | 转换后 span 字段                                                             |
| -------------------- | ---------------------------------------------------------------------------- |
| `session_start`    | 提取 startedAt、piPid                                                        |
| `session_shutdown` | 提取 endedAt                                                                 |
| `model_select`     | 提取 model（取最后一个）                                                     |
| `user`             | input = payload.text                                                         |
| `system_prompt`    | input = payload.systemPrompt                                                 |
| `llm_thinking`     | input = thinking, output = text, tokens, model, timings                      |
| `answer`           | input = thinking, output = text, tokens, model, timings                      |
| `tool_call`        | toolCallId, toolName, input, output, isError, toolDuration, details, content |

**duration 计算规则**:

1. `llm_thinking` / `answer`: 使用 `agentReplyDuration`
2. `tool_call`: 使用 `toolDuration`
3. 其他: 与下一条记录的时间差（上限 1 小时）

**Checkpoint 去重机制**:

- **签名计算**: `spanCount|lastOutputLen|lastTimestamp|endedAt`
- **存储格式**: JSON 文件，`{ [sessionId]: signature }`
- **去重逻辑**: 签名未变化则跳过上传
- **文件位置**: `.pi-capture/uploader_checkpoint.json`

**进程存活检查**:

- 使用 `process.kill(pid, 0)` 检查 pi 进程是否存活
- 用于判断 session 是否还在进行中

**锁机制**:

- 文件锁: `.pi-capture/.uploader.lock`
- 写入当前 PID，启动时检查锁中的 PID 是否存活
- 若锁中的进程已死，则接管锁
- 进程退出时释放锁

**上传协议**:

- **协议**: HTTP/HTTPS POST
- **Content-Type**: `application/json`
- **超时**: 15 秒
- **目标路径**: `/api/sessions/upload`

**请求体结构**:

```json
{
  "sessionID": "xxx",
  "userId": "xxx",
  "projectId": "xxx",
  "startedAt": "2024-01-01T00:00:00Z",
  "endedAt": "2024-01-01T00:01:00Z",
  "model": "claude-3.5-sonnet",
  "piPid": 12345,
  "rawData": "...",
  "spans": [
    {
      "spanId": "uuid",
      "kind": "user",
      "name": "用户提问",
      "status": "success",
      "roundIndex": 0,
      "turnId": 0,
      "input": "问题内容",
      "output": null,
      "tokens": null,
      "model": null,
      "toolCallId": null,
      "toolName": null,
      "isError": false,
      "duration": 1000,
      "llmThinkDuration": null,
      "agentReplyDuration": null,
      "toolDuration": null,
      "details": null,
      "content": null,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### 6.3.2 业务数据上传脚本 (upload-biz.cjs)

**文件路径**: `C:\Users\Lenovo\.pi-biz-capture\upload-biz.cjs`

**运行方式**:

```bash
# 单文件上传
node upload-biz.cjs <jsonl文件路径> <后端URL>

# 全量扫描上传
node upload-biz.cjs --scan-all <后端URL>
```

**JSONL 文件扫描规则**:

- 扫描 `SPOOL_DIR/{userId}/{projectId}/{date}/biz-*.jsonl`
- 递归遍历所有 user/project/date 目录

**核心流程**:

```
1. 获取锁
2. 读取 JSONL 文件
3. 提取 sessionId、userId、projectId
4. 转换 records 为 metrics 数组
5. 计算文件签名，检查 checkpoint
6. POST 上传到服务端
7. 更新 checkpoint
8. 释放锁
```

**签名计算**: `recordCount|lastRecordTimestamp`

**Checkpoint 文件**: `.pi-biz-capture/upload-biz-checkpoint.json`

**上传协议**:

- **目标路径**: `/api/biz-metrics/upload`
- **超时**: 15 秒

**请求体结构**:

```json
{
  "sessionId": "xxx",
  "userId": "xxx",
  "projectId": "xxx",
  "metrics": [
    {
      "agentId": "xxx",
      "taskId": "task_123",
      "durationMs": 302,
      "success": true,
      "inputTokens": 10551,
      "outputTokens": 5293,
      "totalTokens": 15844,
      "callCount": 7,
      "models": ["gpt-4o-mini"],
      "customData": {"pages": 3, "words": 3024},
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 6.4 JSONL 文件字段说明

#### 6.4.1 运行时数据 JSONL (pi-*.jsonl)

**文件命名**: `pi-{sessionId}-{yyyyMMdd}-{HHmmss}.jsonl`

**每行一条 JSON 记录，通用字段**:

| 字段           | 类型              | 说明                               |
| -------------- | ----------------- | ---------------------------------- |
| `t`          | string (ISO 8601) | 事件时间戳                         |
| `userId`     | string            | 用户标识（系统用户名）             |
| `projectId`  | string            | 项目标识（工作目录 SHA1 前 16 位） |
| `sessionID`  | string            | Session 唯一标识 (UUID)            |
| `roundIndex` | number/null       | 对话轮次索引（从 0 开始）          |
| `turnId`     | number/null       | 轮次内的对话turn索引               |
| `spanId`     | string (UUID)     | Span 唯一标识                      |
| `kind`       | string            | 事件类型（见下表）                 |
| `name`       | string            | 事件名称（中文描述）               |
| `status`     | string            | 状态:`success` / `failed`      |
| `payload`    | object            | 事件详情（根据 kind 不同）         |

**kind 类型及对应 payload**:

| kind                 | payload 字段                                                                            | 说明         |
| -------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `session_start`    | `reason`, `pid`, `agent_name`, `agent_id`, `agent_version`                    | Session 启动 |
| `session_shutdown` | `reason`                                                                              | Session 关闭 |
| `user`             | `text`                                                                                | 用户输入内容 |
| `system_prompt`    | `systemPrompt`, `length`                                                            | 系统提示词   |
| `llm_thinking`     | `thinking`, `text`, `toolCalls`, `tokens`, `model`, `timings`               | LLM 思考过程 |
| `answer`           | `text`, `tokens`, `model`, `timings`                                            | 最终回答     |
| `tool_call`        | `toolCallId`, `input`, `output`, `isError`, `error`, `details`, `content` | 工具调用     |
| `tool_execution`   | `toolCallId`, `toolName`, `duration`, `isError`                                 | 工具执行     |
| `model_select`     | `model`, `previousModel`                                                            | 模型选择     |

**tokens 结构**:

```json
{
  "input": 6861,
  "output": 304,
  "cacheRead": 43,
  "cacheWrite": 0,
  "total": 7208
}
```

**timings 结构**:

```json
{
  "llmThink": 2157,
  "agentReply": 7920
}
```

#### 6.4.2 业务数据 JSONL (biz-*.jsonl)

**文件命名**: `biz-{taskName}-{HHmmss}.jsonl`

**每行一条 JSON 记录**:

| 字段          | 类型              | 说明                     |
| ------------- | ----------------- | ------------------------ |
| `t`         | string (ISO 8601) | 事件时间戳               |
| `userId`    | string            | 用户标识                 |
| `projectId` | string            | 项目标识                 |
| `sessionId` | string            | 关联的 Session ID        |
| `agentId`   | string            | Agent 标识               |
| `taskId`    | string            | 任务唯一标识（用于去重） |
| `metrics`   | object            | 指标详情                 |

**metrics 结构**:

| 字段                    | 类型     | 说明             |
| ----------------------- | -------- | ---------------- |
| `durationMs`          | number   | 任务耗时（毫秒） |
| `success`             | boolean  | 是否成功         |
| `tokens.inputTokens`  | number   | 输入 Token 数    |
| `tokens.outputTokens` | number   | 输出 Token 数    |
| `tokens.totalTokens`  | number   | 总 Token 数      |
| `tokens.callCount`    | number   | 调用次数         |
| `tokens.models`       | string[] | 使用的模型列表   |
| `customData`          | object   | 自定义业务数据   |

**示例**:

```json
{
  "t": "2026-08-17T14:45:41.504077",
  "userId": "Lenovo",
  "projectId": "478fe89a551a121f",
  "sessionId": "unknown",
  "agentId": "doc-gen-test",
  "taskId": "task_1786949141_9880",
  "metrics": {
    "durationMs": 302,
    "success": true,
    "tokens": {
      "inputTokens": 10551,
      "outputTokens": 5293,
      "totalTokens": 15844,
      "callCount": 7,
      "models": ["gpt-4o-mini"]
    },
    "customData": {
      "pages": 3,
      "words": 3024,
      "sections": 6,
      "topic": "产品需求文档PRD"
    }
  }
}
```

### 6.5 数据幂等性设计

| 数据            | 去重键                 | 机制                              |
| --------------- | ---------------------- | --------------------------------- |
| Session         | `sessionID`          | `upsert`，已存在则不插入        |
| Span            | `spanId`             | 先查后插，已存在则删除后重新插入  |
| Business Metric | `taskId`             | `findUnique` 检查，已存在则跳过 |
| 上传检查点      | `sessionId` / 文件名 | 签名比对，未变化则不上传          |

### 6.6 环境变量配置

| 变量名                       | 默认值                     | 说明                  |
| ---------------------------- | -------------------------- | --------------------- |
| `PI_CAPTURE_SPOOL_DIR`     | `~/.pi-capture`          | 运行时数据 spool 目录 |
| `PI_CAPTURE_USER`          | 系统用户名                 | 用户标识              |
| `PI_CAPTURE_MAX_STRING`    | 4000                       | 字符串最大长度        |
| `PI_CAPTURE_MAX_TOOL_IO`   | 4000                       | 工具 I/O 最大长度     |
| `PI_CAPTURE_UPLOAD_SCRIPT` | `{SPOOL_DIR}/upload.cjs` | 上传脚本路径          |
| `PI_CAPTURE_BACKEND_URL`   | `http://localhost:3002`  | 后端地址              |
| `PI_BIZ_CAPTURE_SPOOL_DIR` | `~/.pi-biz-capture`      | 业务数据 spool 目录   |
| `PI_BIZ_BACKEND_URL`       | `http://localhost:3000`  | 业务数据后端地址      |

---

## 7. API 接口说明

### 7.1 统计接口

#### GET /api/stats

获取仪表盘统计数据。

**参数**:

| 参数  | 类型   | 说明                                                       |
| ----- | ------ | ---------------------------------------------------------- |
| range | string | `realtime`（今日）/ `weekly`（近7天）/ `all`（全量） |

**响应示例**:

```json
{
  "totalSessions": 42,
  "totalTokens": 1234567,
  "activeAgents": 5,
  "prevTotalSessions": 38,
  "prevTotalTokens": 987654,
  "prevActiveAgents": 4,
  "anomalies": [...],
  "dailyTrend": [...]
}
```

### 7.2 Session 接口

#### GET /api/sessions

获取 Session 列表，按 startTime 倒序。

#### DELETE /api/sessions?id=

删除指定 Session 及其关联的 Span。如果删除后 Project/User/Agent 不再有 Session 引用，也会级联删除。

#### POST /api/sessions/upload

上传 Session 数据（运行时数据上报）。

**请求体**:

```json
{
  "sessionID": "xxx",
  "userId": "xxx",
  "projectId": "xxx",
  "startedAt": "2024-01-01T00:00:00Z",
  "endedAt": "2024-01-01T00:01:00Z",
  "model": "claude-3.5-sonnet",
  "spans": [...]
}
```

#### GET /api/sessions/top

获取 Token 消耗最高的 Session 列表。

### 7.3 Agent 接口

#### GET /api/agents

获取 Agent 列表。

#### GET /api/agents/stats

获取 Agent 统计数据（调用量、成功率）。

### 7.4 Skill 接口

#### GET /api/skills

获取 Skill 列表。

#### GET /api/skills/stats

获取 Skill 调用统计。

#### POST /api/skills/sync

从 Span 数据中提取未注册的 Skill，并自动注册。

### 7.5 业务指标接口

#### POST /api/biz-metrics/upload

上传业务指标数据。

**请求体**:

```json
{
  "sessionId": "xxx",
  "userId": "xxx",
  "projectId": "xxx",
  "metrics": [
    {
      "agentId": "xxx",
      "taskId": "unique-task-id",
      "durationMs": 1500,
      "success": true,
      "inputTokens": 100,
      "outputTokens": 200,
      "callCount": 1,
      "models": ["claude-3.5-sonnet"],
      "customData": {...}
    }
  ]
}
```

### 7.6 实验评测接口

#### GET /api/experiments

获取实验列表。

#### POST /api/experiments

创建新实验。

#### GET /api/experiments/[id]

获取实验详情。

### 7.7 设置接口

#### GET /api/settings

获取用户设置。

#### POST /api/settings

保存用户设置。

---

## 8. 数据库设计

### 8.1 ER 图

```
┌─────────┐       ┌──────────┐       ┌─────────┐
│  User   │       │ Project  │       │  Agent  │
├─────────┤       ├──────────┤       ├─────────┤
│ id (PK) │──┐    │ id (PK)  │   ┌───│ id (PK) │
│ name     │  └───│ userId   │   │   │ name    │
│ org      │       │ agentId  │───┘   │ emoji   │
└─────────┘       └──────────┘       │ framework│
      │              │               └─────────┘
      │              │                    │
      │              ▼                    │
      │         ┌──────────┐              │
      │         │ Session  │──────────────┘
      │         ├──────────┤
      └─────────│ userId   │
                │ agentId  │
                │ projectId│
                │ status   │
                │ total*   │
                └──────────┘
                     │
                     ▼
                ┌──────────┐
                │   Span   │
                ├──────────┤
                │ id (PK)  │
                │ sessionId│
                │ roundIndex│
                │ kind     │
                │ tokens   │
                │ duration │
                └──────────┘
```

### 8.2 表结构详解

#### User 表

| 字段      | 类型          | 说明              |
| --------- | ------------- | ----------------- |
| id        | String (cuid) | 主键              |
| name      | String        | 用户名            |
| org       | String        | 组织/团队，默认空 |
| createdAt | DateTime      | 创建时间          |

#### Agent 表

| 字段                  | 类型            | 说明                           |
| --------------------- | --------------- | ------------------------------ |
| id                    | String (cuid)   | 主键                           |
| name                  | String (unique) | Agent 名称                     |
| emoji                 | String          | 表情图标，默认 🤖              |
| description           | String          | 描述                           |
| framework             | String          | 框架类型，默认 pi-coding-agent |
| version               | String          | 版本号                         |
| createdAt / updatedAt | DateTime        | 时间戳                         |

#### Project 表

| 字段      | 类型          | 说明       |
| --------- | ------------- | ---------- |
| id        | String (cuid) | 主键       |
| name      | String        | 项目名称   |
| userId    | String        | 所属用户   |
| agentId   | String        | 关联 Agent |
| createdAt | DateTime      | 创建时间   |

#### Session 表

| 字段                         | 类型          | 说明                       |
| ---------------------------- | ------------- | -------------------------- |
| id                           | String (cuid) | 主键                       |
| projectId / userId / agentId | String        | 关联字段                   |
| status                       | String        | active / completed / error |
| model                        | String        | 使用的模型                 |
| startTime / endTime          | DateTime      | 时间范围                   |
| totalRounds                  | Int           | 总轮次                     |
| totalSpans                   | Int           | 总 Span 数                 |
| errorCount                   | Int           | 错误数                     |
| totalInputTokens             | Int           | 输入 Token                 |
| totalOutputTokens            | Int           | 输出 Token                 |
| totalCacheReadTokens         | Int           | 缓存读取 Token             |
| totalCacheWriteTokens        | Int           | 缓存写入 Token             |
| totalTokens                  | Int           | 总 Token                   |
| totalDuration                | Int           | 总耗时 (ms)                |
| forkCount                    | Int           | 分支数                     |
| rawData                      | String        | 原始数据 JSON              |

#### Span 表

| 字段                                     | 类型          | 说明                                                          |
| ---------------------------------------- | ------------- | ------------------------------------------------------------- |
| id                                       | String (cuid) | 主键                                                          |
| sessionId                                | String        | 所属 Session                                                  |
| roundIndex                               | Int           | 轮次索引                                                      |
| turnId                                   | Int           | 对话轮次 ID                                                   |
| parentId                                 | String        | 父 Span ID                                                    |
| branchId                                 | String        | 分支 ID                                                       |
| kind                                     | String        | 类型：user/llm_thinking/tool_call/command/answer/error/system |
| name                                     | String        | Span 名称                                                     |
| status                                   | String        | success / failed / running                                    |
| startTime                                | Int           | 开始时间 (Unix 秒)                                            |
| duration                                 | Int           | 耗时 (ms)                                                     |
| inputTokens / outputTokens / totalTokens | Int           | Token 统计                                                    |
| cacheReadTokens / cacheWriteTokens       | Int           | 缓存 Token                                                    |
| model                                    | String        | 使用的模型                                                    |
| input / output                           | String        | 输入/输出内容                                                 |
| error                                    | String        | 错误信息                                                      |
| llmThinkDuration                         | Int           | LLM 思考耗时                                                  |
| agentReplyDuration                       | Int           | Agent 回复耗时                                                |
| toolDuration                             | Int           | 工具调用耗时                                                  |
| details / content                        | String        | 详细内容                                                      |
| isForkPoint                              | Boolean       | 是否为分支点                                                  |

#### Skill 表

| 字段         | 类型            | 说明                     |
| ------------ | --------------- | ------------------------ |
| id           | String (cuid)   | 主键                     |
| name         | String (unique) | Skill 名称               |
| description  | String          | 描述                     |
| skillMd      | String          | SKILL.md 内容            |
| contentHash  | String          | 内容哈希（用于变更检测） |
| version      | Int             | 版本号                   |
| lastSyncedAt | DateTime        | 最后同步时间             |

#### BusinessMetric 表

| 字段                                     | 类型          | 说明                 |
| ---------------------------------------- | ------------- | -------------------- |
| id                                       | String (cuid) | 主键                 |
| sessionId / userId / projectId / agentId | String        | 关联字段             |
| taskId (unique)                          | String        | 任务唯一标识         |
| durationMs                               | Int           | 耗时                 |
| success                                  | Boolean       | 是否成功             |
| inputTokens / outputTokens / totalTokens | Int           | Token 统计           |
| callCount                                | Int           | 调用次数             |
| models                                   | String        | 使用的模型 JSON 数组 |
| customData                               | String        | 自定义数据 JSON      |

#### Experiment 表

| 字段             | 类型          | 说明                          |
| ---------------- | ------------- | ----------------------------- |
| id               | String (cuid) | 主键                          |
| userId           | String        | 创建者                        |
| name             | String        | 实验名称                      |
| type             | String        | 实验类型：single / comparison |
| agentId          | String        | 被测 Agent                    |
| evaluatorIdsJson | String        | Evaluator ID 列表 JSON        |
| status           | String        | draft / running / completed   |
| scope            | String        | 实验范围                      |
| watchMode        | Boolean       | 是否开启监听模式              |

#### ExperimentCase 表

| 字段            | 类型          | 说明         |
| --------------- | ------------- | ------------ |
| id              | String (cuid) | 主键         |
| experimentId    | String        | 所属实验     |
| sessionId       | String        | 关联 Session |
| input           | String        | 输入内容     |
| actualOutput    | String        | 实际输出     |
| referenceOutput | String        | 参考答案     |

#### ExperimentEvalResult 表

| 字段                                         | 类型          | 说明                         |
| -------------------------------------------- | ------------- | ---------------------------- |
| id                                           | String (cuid) | 主键                         |
| experimentId / caseId / evaluatorId          | String        | 关联字段                     |
| status                                       | String        | pending / completed / failed |
| verdict                                      | String        | 判定结果                     |
| summary                                      | String        | 评价摘要                     |
| score                                        | Float         | 评分                         |
| pointsJson                                   | String        | 详细评分点 JSON              |
| evidenceJson                                 | String        | 证据 JSON                    |
| humanScore / humanReason / humanBy / humanAt | —            | 人工复核信息                 |

#### UserSettings 表

| 字段          | 类型          | 说明      |
| ------------- | ------------- | --------- |
| id            | String (cuid) | 主键      |
| user (unique) | String        | 用户名    |
| settingsJson  | String        | 设置 JSON |

---

## 9. 部署与运维

### 9.1 当前状态

- **部署方式**: 本地开发，未部署
- **数据库**: SQLite 文件型数据库（`prisma/dev.db`）

### 9.2 构建命令

```bash
# 构建生产版本
npm run build

# 启动生产服务器
npm run start
```

### 9.3 数据库迁移

```bash
# 创建迁移文件
npx prisma migrate dev --name <migration_name>

# 应用迁移
npx prisma migrate deploy

# 重置数据库（慎用）
npx prisma migrate reset
```

### 9.4 环境变量

| 变量名       | 说明              | 默认值                    |
| ------------ | ----------------- | ------------------------- |
| DATABASE_URL | SQLite 数据库路径 | `file:../prisma/dev.db` |

---

## 10. 已知问题与 TODO

### 10.1 未完成功能

| 功能     | 状态   | 说明                                     |
| -------- | ------ | ---------------------------------------- |
| 实验评测 | 开发中 | 核心流程已实现，但界面和完整功能还在迭代 |

### 10.2 已知小问题

- 代码中存在少量 TODO 注释标记的临时方案
- 部分硬编码值（如默认 Agent 名称 `pi-coding-agent`）

### 10.3 后续可能的优化方向

- 数据库从 SQLite 迁移到 PostgreSQL（支持更高并发）
- 增加更多异常检测规则
- 实验评测功能完善
- 增加数据导出功能

---

## 11. 交接检查清单

### 11.1 知识移交

- [ ] 已讲解项目背景和业务场景
- [ ] 已讲解技术栈选型原因
- [ ] 已讲解数据流链路（pi → extensions → jsonl → upload → API → DB → 前端）
- [ ] 已讲解数据库表结构关系
- [ ] 已讲解核心 API 接口
- [ ] 已演示本地环境搭建过程
- [ ] 已演示数据上传脚本的工作方式

### 11.2 权限与账号

- [ ] 代码仓库访问权限
- [ ] 相关服务器访问权限（如有）
- [ ] 第三方服务账号（LLM API Key 等）
- [ ] pi Agent 相关配置路径访问权限

### 11.3 文件移交

- [ ] 项目源代码
- [ ] `.env` 环境变量文件
- [ ] `prisma/dev.db` 数据库文件（或种子数据脚本）
- [ ] pi 扩展脚本（`C:\Users\Lenovo\.pi\agent\extensions`）
- [ ] 数据上传脚本（`C:\Users\Lenovo\.pi-capture\upload.cjs`、`C:\Users\Lenovo\.pi-biz-capture\upload-biz.cjs`）
- [ ] 相关文档和配置

### 11.4 交接后支持

- [ ] 约定答疑时间窗口
- [ ] 提供联系方式
- [ ] 记录遗留问题的处理方式

---

## 附录

### A. 相关路径汇总

| 路径                                               | 说明                          |
| -------------------------------------------------- | ----------------------------- |
| `E:\wzrong\TEST\LinkAI_Insight(8.13)`            | 项目根目录                    |
| `C:\Users\Lenovo\.pi\agent\extensions`           | pi Agent 扩展脚本（数据捕获） |
| `C:\Users\Lenovo\.pi-capture\upload.cjs`         | 运行时数据上传脚本            |
| `C:\Users\Lenovo\.pi-biz-capture\upload-biz.cjs` | 业务数据上传脚本              |

### B. 常用命令速查

```bash
# 启动开发服务器
npm run dev

# 构建
npm run build

# 数据库操作
npx prisma studio          # 打开数据库可视化
npx prisma db push         # 推送 schema 到数据库
npx prisma generate        # 生成 Prisma Client
npx prisma migrate dev     # 创建并应用迁移

# 导入种子数据
node prisma/seed.js
```

### C. 关键类型定义

```typescript
// Span 类型
type SpanKind = "user" | "llm_thinking" | "tool_call" | "command" | "answer" | "error" | "system";
type SpanStatus = "success" | "failed" | "running";

// Session 状态
type SessionStatus = "active" | "completed" | "error";

// Agent 框架类型
type Framework = "opencode" | "claude-code" | "hermes" | "langgraph" | "jiuwen-swarm";
```

---

> **文档结束**
>
> 如有疑问，请联系原开发者。
