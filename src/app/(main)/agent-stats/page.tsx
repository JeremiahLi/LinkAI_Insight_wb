"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { formatNumber } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
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

interface StatsData {
  activeAgents: number;
  totalCalls: number;
  errorAgents: number;
  successRate: number;
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
  const [statsData, setStatsData] = useState<StatsData>({ activeAgents: 0, totalCalls: 0, errorAgents: 0, successRate: 100, agents: [] });
  const [trendData, setTrendData] = useState<TrendCompareData>({ labels: [], series: [] });
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
        setStatsData({ activeAgents: 0, totalCalls: 0, errorAgents: 0, successRate: 100, agents: [] });
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="活跃 Agent" value={String(statsData.activeAgents)} sub={`${rangeLabel}运行`} />
        <KpiCard label="总调用次数" value={formatNumber(statsData.totalCalls)} sub={`${rangeLabel}累计`} />
        <KpiCard
          label="异常 Agent"
          value={String(statsData.errorAgents)}
          sub={statsData.errorAgents > 0 ? "需要关注" : "一切正常"}
          subTone={statsData.errorAgents > 0 ? "warning" : "success"}
        />
        <KpiCard label="平均成功率" value={`${statsData.successRate}%`} sub="Session 成功比例" />
      </div>

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

function rateColor(rate: number | null) {
  if (rate == null) return "text-muted-foreground";
  if (rate >= 97) return "text-success";
  if (rate >= 93) return "text-warning";
  return "text-destructive";
}
