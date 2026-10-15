# LinkAI Insight

Agent 运维观测平台，用于监控和分析 AI Agent 的运行状态、Token 消耗、Skill 调用链路与业务指标。

## 技术栈

- **框架**: Next.js 16 + React 19
- **语言**: TypeScript
- **样式**: Tailwind CSS 4 + shadcn/ui
- **数据库**: SQLite + Prisma ORM
- **图表**: Recharts
- **主题**: next-themes (支持深色模式)

## 功能模块

| 模块 | 路径 | 说明 |
|------|------|------|
| 概览仪表盘 | `/` | 核心指标监控、异常预警、Agent/Skill/Session 排行 |
| 链路追踪 | `/trace` | Session 调用链路详情、Span 树状图 |
| 业务数据看板 | `/biz-stats` | 业务指标统计与趋势 |
| Skill 使用看板 | `/skill-stats` | Skill 调用次数与热度 |
| Agent 性能看板 | `/agent-stats` | Agent 调用统计与成功率 |
| 评测中心 | `/experiments` | 实验管理与评估结果 |
| 告警中心 | `/alerts` | 异常告警记录 |
| 设置 | `/settings` | 系统配置 |

## 快速开始

### 环境要求

- Node.js >= 18
- npm / pnpm / yarn

### 安装依赖

```bash
npm install
```

### 配置数据库

1. 创建 `.env` 文件：

```env
DATABASE_URL="file:./dev.db"
```

2. 初始化数据库：

```bash
npx prisma migrate dev
```

3. （可选）导入种子数据：

```bash
node prisma/seed.js
```

### 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3002](http://localhost:3002)

### 构建生产版本

```bash
npm run build
npm start
```

## 项目结构

```
├── prisma/                  # Prisma 配置与数据模型
│   ├── schema.prisma        # 数据库模型定义
│   └── seed.js              # 种子数据
├── public/                  # 静态资源
├── scripts/                 # 工具脚本
│   ├── upload-biz.cjs       # 业务数据上传
│   └── lib/                 # Biz-Capture SDK
└── src/
    ├── app/
    │   ├── (main)/          # 主应用页面
    │   │   ├── page.tsx     # 仪表盘
    │   │   ├── trace/       # 链路追踪
    │   │   ├── biz-stats/   # 业务数据
    │   │   ├── skill-stats/ # Skill 看板
    │   │   ├── agent-stats/ # Agent 看板
    │   │   ├── experiments/ # 评测中心
    │   │   ├── alerts/      # 告警中心
    │   │   └── settings/    # 设置
    │   └── api/             # API 路由
    ├── components/
    │   ├── shell/           # 应用外壳（侧边栏、顶栏）
    │   ├── ui/              # 基础 UI 组件
    │   ├── trace/           # 链路追踪组件
    │   ├── agent/           # Agent 相关组件
    │   └── skill/           # Skill 相关组件
    └── lib/                 # 工具函数与 Hooks
```

## 数据模型

| 模型 | 说明 |
|------|------|
| `User` | 用户 |
| `Agent` | AI Agent 配置 |
| `Project` | 项目（关联 User 与 Agent） |
| `Session` | 会话记录（Token 消耗、状态等） |
| `Span` | 调用链路节点（工具调用、LLM 思考等） |
| `Skill` | Skill 定义与元数据 |
| `BusinessMetric` | 业务指标数据 |
| `Experiment` | 评测实验 |
| `ExperimentCase` | 实验用例 |
| `ExperimentEvalResult` | 评估结果 |
| `UserSettings` | 用户设置 |

## API 路由

| 路由 | 说明 |
|------|------|
| `/api/stats` | 统计数据 |
| `/api/sessions/top` | Session 排行 |
| `/api/sessions/upload` | Session 数据上传 |
| `/api/skills/stats` | Skill 统计 |
| `/api/skills/sync` | Skill 同步 |
| `/api/agents/stats` | Agent 统计 |
| `/api/biz-metrics/stats` | 业务指标统计 |
| `/api/biz-metrics/upload` | 业务指标上传 |
| `/api/experiments/*` | 实验管理 |
| `/api/settings` | 设置管理 |

## 脚本说明

| 脚本 | 说明 |
|------|------|
| `upload-biz.cjs` | 上传采集的业务指标数据到后端 |
| `pi-extension-biz-capture.ts` | Pi Agent 业务数据采集扩展 |
| `lib/biz-capture.ts` | 业务数据上报 SDK |
| `lib/pi_biz_capture/` | Python 版上报 SDK |

## License

Private
