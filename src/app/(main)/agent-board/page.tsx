"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { Sparkline } from "@/components/charts/sparkline";
import { FancyBarChartH } from "@/components/charts/fancy-bar-chart-h";
import { MultiLineTrendChart } from "@/components/charts/multi-line-trend-chart";
import { AgentCompareTable } from "@/components/agent/agent-compare-table";
import { formatDuration, formatNumber, formatTokens, pctChange } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import { HEALTH_WINDOW_DAYS } from "@/lib/engine/stats/health";
import type { AgentBoard } from "@/lib/engine/stats/agent-board";
import type { AgentTrendMetric } from "@/lib/engine/stats/trend";
import { cn } from "@/lib/utils";

/**
 * Agent 看板（横向 / 全局视角）。
 *
 * 与「用户看板」的分工：用户看板回答「谁在用」，本页回答「Agent 用得怎么样」：
 *   1. KPI 行     —— 多少 Agent 在跑、整体成功率、整体耗时水位
 *   2. 活跃分层   —— 今日/近7天/近30天各有几个在跑，谁沉默了
 *   3. 使用趋势   —— 各 Agent 的会话数 / Token / 失败数走势
 *   4. 工具失败率 —— 唯一能一眼看出「谁在坏」的形状
 *   5. 对比矩阵   —— 全量指标 + 健康分，可排序、可下钻
 *
 * 口径：时间过滤用 Session.startTime；成功率 = 1 - 有失败 span 的会话占比；
 * 健康分固定近 30 天（与页面时间档解耦），列头已标注。
 */

const METRIC_OPTIONS: { value: AgentTrendMetric; label: string }[] = [
  { value: "sessions", label: "会话数" },
  { value: "tokens", label: "Token" },
  { value: "failed", label: "失败会话" },
];

type Granularity = "day" | "week";

interface TrendData {
  labels: string[];
  series: { name: string; data: number[] }[];
}

export default function AgentBoardPage() {
  const [range, setRange] = useState<StatsRange>("30d");
  const [metric, setMetric] = useState<AgentTrendMetric>("sessions");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<AgentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<TrendData>({ labels: [], series: [] });
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/dashboard/agents/board?range=${range}`)
      .then((r) => r.json())
      .then((d: AgentBoard & { error?: string }) => {
        if (cancelled || d.error) return;
        setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    setTrendLoading(true);
    fetch(`/api/dashboard/agents/trend-compare?range=${range}&granularity=${granularity}&metric=${metric}`)
      .then((r) => r.json())
      .then((d: TrendData) => {
        if (cancelled) return;
        setTrend({ labels: d.labels ?? [], series: d.series ?? [] });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTrendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, granularity, metric]);

  if (!data) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">{loading ? "加载中..." : "加载失败，请刷新重试"}</p>
      </div>
    );
  }

  const { kpi } = data;

  // 工具失败率对比：样本太小的 Agent（<5 次调用）不参与，避免 1/1=100% 抢眼
  // 名字过长的截断，否则 Y 轴标签会折行叠在一起（完整名在上面的矩阵表里）
  const shortName = (n: string) => (n.length > 13 ? `${n.slice(0, 13)}…` : n);
  const failRateData = data.agents
    .filter((a) => a.toolCalls >= 5 && a.toolFailRate != null)
    .map((a) => ({ name: shortName(a.name), value: Number(a.toolFailRate!.toFixed(2)) }))
    .sort((a, b) => b.value - a.value);
  const toolCallsTotal = data.agents.reduce((s, a) => s + a.toolCalls, 0);
  const toolFailedTotal = data.agents.reduce((s, a) => s + a.toolFailed, 0);
  const silentNames = data.agents.filter((a) => a.sessions === 0).map((a) => a.name);

  return (
    <div className={cn("flex flex-col gap-5 p-6 transition-opacity", loading && "opacity-60")}>
      <PageHeader
        title="Agent 看板"
        description={`全量 Agent 的使用对比与健康状态（${data.range}）· 成功率按「有失败 span 的会话」计`}
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={range}
            onChange={setRange}
          />
        }
      />

      {/* 1. KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="活跃 Agent"
          value={`${kpi.activeAgents} / ${kpi.agentTotal}`}
          sub={kpi.silentAgents > 0 ? `沉默 ${kpi.silentAgents} 个` : "全部有使用"}
          subTone={kpi.silentAgents > 0 ? "warning" : "success"}
          trend={pctChange(kpi.activeAgents, kpi.activeAgentsPrev)}
        />
        <KpiCard
          label="总会话数"
          value={formatNumber(kpi.sessions)}
          sub={`失败 ${kpi.badSessions} 个会话`}
          trend={pctChange(kpi.sessions, kpi.sessionsPrev)}
        />
        <KpiCard
          label="整体成功率"
          value={`${kpi.successRate.toFixed(1)}%`}
          sub={`Span 失败率 ${kpi.spanFailRate.toFixed(1)}%（${formatNumber(kpi.failedSpans)}/${formatNumber(kpi.spans)}）`}
          subTone={kpi.successRate >= 97 ? "success" : kpi.successRate >= 93 ? "warning" : "destructive"}
        />
        <KpiCard
          label="P95 会话耗时"
          value={kpi.p95SampleCount < 10 ? "—" : formatDuration(kpi.p95Duration)}
          sub={kpi.p95SampleCount < 10 ? `有效样本仅 ${kpi.p95SampleCount} 个，不显示` : `有效样本 ${kpi.p95SampleCount} 个会话`}
        />
      </div>

      {/* 2. 活跃分层 + 3. 工具失败率 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>活跃 Agent 分层</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              固定近 {HEALTH_WINDOW_DAYS} 天窗口，与上方时间档无关
            </span>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col pt-4">
            <div className="grid grid-cols-3 gap-3">
              {data.windows.map((w) => (
                <div key={w.key} className="rounded-lg bg-muted/40 px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">{w.label}</p>
                  <div className="mt-1 flex items-end justify-between gap-1">
                    <p className="font-mono text-xl font-semibold leading-none tabular-nums">
                      {w.activeAgents}
                      <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">个</span>
                    </p>
                    {/* 只有 1 个点时画不出走势，留空比画一条假线诚实 */}
                    {w.dailyAgents.length >= 3 ? (
                      <Sparkline data={w.dailyAgents} width={56} height={18} />
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{w.sessions} 会话</p>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-[13px]">
              <div className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">本期沉默</span>
                {silentNames.length === 0 ? (
                  <span className="text-success">无，全部 Agent 都在使用</span>
                ) : (
                  <span className="leading-relaxed">{silentNames.join("、")}</span>
                )}
              </div>
              <div className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">本期新增</span>
                <span className="leading-relaxed">
                  {data.newAgents.length > 0 ? data.newAgents.join("、") : "—"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">本期消失</span>
                <span className="leading-relaxed">
                  {data.lostAgents.length > 0 ? (
                    <span className="text-warning">{data.lostAgents.join("、")}</span>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
            <CardTitle>工具失败率</CardTitle>
            <span className="text-[11px] text-muted-foreground/80">
              {formatNumber(toolFailedTotal)} / {formatNumber(toolCallsTotal)} 次失败
            </span>
          </CardHeader>
          <CardContent className="h-[210px] pt-4">
            {failRateData.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                该时间段工具调用不足 5 次
              </p>
            ) : (
              <FancyBarChartH
                data={failRateData}
                valueFormatter={(v) => `${v.toFixed(1)}%`}
                ariaLabel="工具失败率"
                yAxisInterval={0}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4. 使用量趋势 */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b border-border/60 pb-2.5">
          <div>
            <CardTitle>使用量趋势</CardTitle>
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">
              按所选指标取 Top 8 Agent，其余不画
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
            <SegmentedControl
              options={[
                { value: "day", label: "每天" },
                { value: "week", label: "每周" },
              ]}
              value={granularity}
              onChange={setGranularity}
            />
          </div>
        </CardHeader>
        <CardContent className={cn("pt-4 transition-opacity", trendLoading && "opacity-50")}>
          {trend.labels.length === 0 ? (
            <p className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              该时间段暂无数据
            </p>
          ) : (
            <MultiLineTrendChart
              labels={trend.labels}
              series={trend.series}
              height={280}
              valueFormatter={metric === "tokens" ? (v) => formatTokens(v) : undefined}
            />
          )}
        </CardContent>
      </Card>

      {/* 5. 对比矩阵 */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>Agent 对比矩阵</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            点击列头排序 · 点击 Agent 名进入单 Agent 视角 · 健康分固定近 {HEALTH_WINDOW_DAYS} 天
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <AgentCompareTable rows={data.agents} />
        </CardContent>
      </Card>
    </div>
  );
}
