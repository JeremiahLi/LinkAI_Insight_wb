"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { formatDuration, formatNumber, rateColor } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import { AGENT_ERROR_RATE_THRESHOLD } from "@/lib/engine/stats/anomalies";
import { FancyBarChartH } from "@/components/charts/fancy-bar-chart-h";
import { MultiLineTrendChart } from "@/components/charts/multi-line-trend-chart";
import { AgentDetailPanel } from "@/components/agent/agent-detail-panel";
import { cn } from "@/lib/utils";

type Granularity = "day" | "week";

interface AgentRow {
  id: string;
  name: string;
  emoji: string;
  description: string;
  version: string;
  framework: string;
  calls: number;
  successRate: number | null;
}

/** 异常 Agent 名单项（与概览异常预警同一口径） */
interface ErrorAgentEntry {
  name: string;
  errors: number;
  total: number;
  errorRate: number;
}

interface StatsData {
  activeAgents: number;
  totalCalls: number;
  errorAgents: number;
  errorAgentList: ErrorAgentEntry[];
  successRate: number;
  avgDurationMs: number;
  tokensPerCall: number;
  agents: AgentRow[];
}

interface TrendCompareData {
  labels: string[];
  series: { name: string; data: number[] }[];
}

/** 点开的 Agent（含异步补全的 README 信息） */
interface SelectedAgent extends AgentRow {
  readme: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function AgentStatsPage() {
  const [timeRange, setTimeRange] = useState<StatsRange>("30d");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(null);
  const [statsData, setStatsData] = useState<StatsData>({ activeAgents: 0, totalCalls: 0, errorAgents: 0, errorAgentList: [], successRate: 100, avgDurationMs: 0, tokensPerCall: 0, agents: [] });
  const [trendData, setTrendData] = useState<TrendCompareData>({ labels: [], series: [] });
  const [errorListOpen, setErrorListOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === timeRange)?.label ?? "";

  // 点击卡片：先展示已有统计，再异步补全 README 等详情
  const handleAgentClick = (agent: AgentRow) => {
    setSelectedAgent({ ...agent, readme: "" });
    fetch(`/api/agents/${encodeURIComponent(agent.name)}`)
      .then((r) => r.json())
      .then((data) => {
        setSelectedAgent((prev) =>
          prev && prev.id === agent.id
            ? { ...prev, readme: data.readme || "", createdAt: data.createdAt, updatedAt: data.updatedAt }
            : prev,
        );
      })
      .catch(() => {});
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/agents/stats?range=${timeRange}`).then((r) => r.json()),
      fetch(`/api/dashboard/agents/trend-compare?range=${timeRange}&granularity=${granularity}`).then((r) => r.json()),
    ])
      .then(([stats, trend]) => {
        setStatsData(stats);
        setTrendData({ labels: trend.labels ?? [], series: trend.series ?? [] });
      })
      .catch(() => {
        setStatsData({ activeAgents: 0, totalCalls: 0, errorAgents: 0, errorAgentList: [], successRate: 100, avgDurationMs: 0, tokensPerCall: 0, agents: [] });
        setTrendData({ labels: [], series: [] });
      })
      .finally(() => setLoading(false));
  }, [timeRange, granularity]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  // 调用量对比柱状图数据（全部 Agent，不带 emoji）
  const compareData = statsData.agents
    .filter((a) => a.calls > 0)
    .map((a) => ({ name: a.name, value: a.calls }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Agent 性能看板"
        description={`各 Agent 运行状态与调用性能（${rangeLabel}）`}
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={timeRange}
            onChange={setTimeRange}
          />
        }
      />

      {/* Stats：性能向指标，与概览仪表盘错位（概览负责活跃度，这里负责性能与健康） */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="总调用次数" value={formatNumber(statsData.totalCalls)} sub={`${rangeLabel}累计`} />
        <KpiCard
          label="平均耗时"
          value={statsData.avgDurationMs > 0 ? formatDuration(statsData.avgDurationMs) : "—"}
          sub="Session 平均耗时"
        />
        <div
          onClick={statsData.errorAgents > 0 ? () => setErrorListOpen(!errorListOpen) : undefined}
          className={statsData.errorAgents > 0 ? "cursor-pointer" : undefined}
        >
          <KpiCard
            label="异常 Agent"
            value={String(statsData.errorAgents)}
            sub={statsData.errorAgents > 0 ? `错误率 > ${Math.round(AGENT_ERROR_RATE_THRESHOLD * 100)}%，点击${errorListOpen ? "收起" : "展开"}` : "一切正常"}
            subTone={statsData.errorAgents > 0 ? "warning" : "success"}
          />
        </div>
        <KpiCard label="平均成功率" value={`${statsData.successRate}%`} sub="Session 成功比例" />
      </div>

      {/* 异常 Agent 名单：与概览异常预警同一判定函数（lib/engine/stats/anomalies） */}
      {errorListOpen && statsData.errorAgentList.length > 0 && (
        <div className="rounded-lg px-4 py-3 ring-1 bg-destructive/5 ring-destructive/25">
          <p className="text-[13px] font-medium">异常 Agent 名单</p>
          <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
            {statsData.errorAgentList.map((a) => (
              <div key={a.name} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  {a.name}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {a.errors}/{a.total} 错误 · <span className="text-destructive">{a.errorRate}%</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 调用量对比 + 使用趋势 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Agent 调用量对比</CardTitle>
          </CardHeader>
          <CardContent className="h-[260px] pt-4">
            {compareData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">该时间段暂无调用</p>
            ) : (
              <FancyBarChartH data={compareData} valueFormatter={(v) => formatNumber(v)} ariaLabel="调用次数" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>Agent 使用趋势</CardTitle>
            <SegmentedControl
              options={[
                { value: "day", label: "每天" },
                { value: "week", label: "每周" },
              ]}
              value={granularity}
              onChange={setGranularity}
            />
          </CardHeader>
          <CardContent className="h-[260px] pt-4">
            {trendData.labels.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">该时间段暂无数据</p>
            ) : (
              <MultiLineTrendChart labels={trendData.labels} series={trendData.series} height={240} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Cards Grid */}
      <div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {statsData.agents?.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onClick={() => handleAgentClick(agent)} />
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      <AgentDetailPanel
        agent={selectedAgent ? { ...selectedAgent, readme: "" } : null}
        open={selectedAgent !== null}
        onClose={() => setSelectedAgent(null)}
        timeRange={timeRange === "all" ? "30d" : timeRange}
      />
    </div>
  );
}

function AgentCard({ agent, onClick }: { agent: AgentRow; onClick: () => void }) {
  return (
    <Card
      className="cursor-pointer flex-col gap-3 p-4 transition-colors hover:ring-foreground/25"
      onClick={onClick}
    >
      {/* Header: Name + Version */}
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold">{agent.name}</p>
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          v{agent.version}
        </span>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{agent.description}</p>

      {/* Metrics：等宽数字右对齐，靠细分隔线分区 */}
      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
        <div>
          <p className="text-[11px] text-muted-foreground">调用次数</p>
          <p className="font-mono text-base font-semibold tabular-nums tracking-tight">{formatNumber(agent.calls)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">成功率</p>
          <p className={cn("font-mono text-base font-semibold tabular-nums tracking-tight", rateColor(agent.successRate))}>
            {agent.successRate != null ? `${agent.successRate}%` : "—"}
          </p>
        </div>
      </div>
    </Card>
  );
}
