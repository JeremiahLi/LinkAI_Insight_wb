"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { formatNumber, formatTokens, formatDuration } from "@/lib/format";
import { useChartColors } from "@/lib/use-chart-colors";

type TimeRange = "realtime" | "weekly";

interface Overview {
  totalTasks: number;
  totalTokens: number;
  activeAgents: number;
}

interface Ranking {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  taskCount: number;
  totalTokens: number;
}

interface TrendPoint {
  date: string;
  tokens: number;
  tasks: number;
}

interface TaskRecord {
  id: string;
  agentName: string;
  agentEmoji: string;
  taskId: string;
  createdAt: string;
  durationMs: number;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
  customData: Record<string, string | number>;
}

export default function BizStatsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("realtime");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const colors = useChartColors();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/biz-metrics/stats?range=${timeRange}`)
      .then((r) => r.json())
      .then((data) => {
        setOverview(data.overview);
        setRankings(data.rankings || []);
        setTrend(data.trend || []);
        setTasks(data.tasks || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [timeRange]);

  if (loading || !overview) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  const rankChartData = rankings.slice(0, 5).map((r) => ({
    name: r.agentName,
    tasks: r.taskCount,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="业务数据看板"
        description="Agent 业务执行产出与明细"
        actions={
          <SegmentedControl
            options={[
              { value: "realtime", label: "今日" },
              { value: "weekly", label: "近 7 天" },
            ]}
            value={timeRange}
            onChange={setTimeRange}
          />
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KpiCard
          label="总任务数"
          value={formatNumber(overview.totalTasks)}
          sub={timeRange === "realtime" ? "今日执行" : "本周执行"}
        />
        <KpiCard label="总 Token" value={formatTokens(overview.totalTokens)} sub="脚本内 LLM 消耗" />
        <KpiCard label="活跃 Agent" value={String(overview.activeAgents)} sub="个 Agent 被调用" />
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Agent Ranking */}
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Agent 产出排行</CardTitle>
          </CardHeader>
          <CardContent className="h-[220px] pt-4">
            {rankChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rankChartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={colors.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: colors.text }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    width={180}
                    tick={<BizTick fill={colors.text} />}
                  />
                  <Tooltip
                    cursor={{ fill: colors.grid, opacity: 0.4 }}
                    contentStyle={{
                      backgroundColor: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                      color: colors.text,
                    }}
                    formatter={(value) => [formatNumber(value as number), "任务数"]}
                  />
                  <Bar dataKey="tasks" radius={[0, 3, 3, 0]} barSize={16}>
                    {rankChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={colors.bars[index % colors.bars.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>

        {/* Token Trend */}
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Token 消耗趋势</CardTitle>
          </CardHeader>
          <CardContent className="h-[220px] pt-4">
            {trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="bizTokenGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.areaStroke} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={colors.areaStroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: colors.text }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: colors.text }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatTokens(v)}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      fontSize: 12,
                      color: colors.text,
                    }}
                    formatter={(value) => [formatTokens(value as number), "Token"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="tokens"
                    stroke={colors.areaStroke}
                    fill="url(#bizTokenGradient)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Task Detail Table */}
      <Card className="flex min-h-0 flex-col">
        <CardHeader className="shrink-0 border-b border-border/60 pb-2.5">
          <CardTitle>任务明细</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto p-0 scrollbar-thin">
          {tasks.length > 0 ? (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b text-left text-[11px] font-medium text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">时间</th>
                  <th className="px-4 py-2.5 font-medium">业务产出</th>
                  <th className="px-4 py-2.5 text-right font-medium">Token</th>
                  <th className="px-4 py-2.5 text-right font-medium">耗时</th>
                  <th className="px-4 py-2.5 text-center font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {tasks.map((task) => (
                  <tr key={task.id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{task.agentName}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(task.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <CustomDataBadge customData={task.customData} />
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{formatTokens(task.totalTokens)}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{formatDuration(task.durationMs)}</td>
                    <td className="px-4 py-2 text-center">
                      {task.success ? (
                        <span className="inline-flex items-center gap-1.5 rounded-sm bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
                          <span className="h-1 w-1 rounded-full bg-success" />
                          成功
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                          <span className="h-1 w-1 rounded-full bg-destructive" />
                          失败
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex h-full items-center justify-center py-12 text-sm text-muted-foreground">暂无数据</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BizTick(props: { x?: number; y?: number; payload?: { value: string }; fill?: string }) {
  const { y = 0, payload, fill } = props;
  const text = payload?.value || "";
  return (
    <text y={y} dy={4} textAnchor="start" fill={fill} fontSize={12}>
      <tspan x={4}>{text}</tspan>
    </text>
  );
}

function CustomDataBadge({ customData }: { customData: Record<string, string | number> }) {
  const entries = Object.entries(customData);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;

  const labels: Record<string, string> = {
    pages: "页",
    issues: "问题",
    risk: "风险",
    files: "文件",
    lines: "行",
    lang: "",
    items: "项",
    passed: "通过",
    compliance: "",
    modules: "模块",
    apis: "接口",
    coverage: "%覆盖",
    models: "模型",
    blocks: "块",
    simulations: "仿真",
    requirements: "需求",
    woven: "编织",
    words: "字",
    format: "",
    topic: "",
  };

  return (
    <div className="flex flex-wrap gap-1">
      {entries.slice(0, 4).map(([key, val]) => (
        <span
          key={key}
          className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {val}
          {labels[key] || key}
        </span>
      ))}
    </div>
  );
}
