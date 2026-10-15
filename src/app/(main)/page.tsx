"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { formatNumber, formatTokens } from "@/lib/format";
import { useChartColors } from "@/lib/use-chart-colors";
import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface RealStats {
  totalSessions: number;
  totalTokens: number;
  activeAgents: number;
  prevTotalSessions?: number;
  prevTotalTokens?: number;
  prevActiveAgents?: number;
  anomalies?: { type: string; severity: "critical" | "warning"; message: string; sessionIds?: string[] }[];
  dailyTrend?: { label: string; tokens: number }[];
}

interface TopSession {
  id: string;
  totalTokens: number;
  totalDuration: number;
  totalRounds: number;
  totalSpans: number;
  status: string;
  model: string;
  agentName: string;
  agentEmoji: string;
  startTime: string;
}

type TimeRange = "realtime" | "weekly";

/** 列表行共用的等宽右对齐数字样式 */
const numCell = "font-mono text-[13px] tabular-nums text-right";

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("realtime");

  const [realStats, setRealStats] = useState<RealStats | null>(null);
  const [allStats, setAllStats] = useState<RealStats | null>(null);
  const [topSessions, setTopSessions] = useState<TopSession[]>([]);
  const [skillStats, setSkillStats] = useState<{ total: number; prevTotal: number }>({ total: 0, prevTotal: 0 });
  const [agentStats, setAgentStats] = useState<{ id: string; name: string; emoji: string; calls: number; successRate: number | null }[]>([]);
  const [skillStatsList, setSkillStatsList] = useState<{ name: string; calls: number }[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const colors = useChartColors();

  useEffect(() => {
    setStatsLoading(true);
    Promise.all([
      fetch(`/api/stats?range=${timeRange}`).then((r) => r.json()),
      fetch("/api/stats?range=all").then((r) => r.json()),
      fetch(`/api/sessions/top?range=${timeRange}`).then((r) => r.json()),
      fetch(`/api/skills/stats?range=${timeRange}`).then((r) => r.json()),
      fetch(`/api/agents/stats?range=${timeRange}`).then((r) => r.json()),
    ])
      .then(([rangeData, allData, topData, skillData, agentData]: [RealStats, RealStats, TopSession[], { total: number; prevTotal: number; skills: { name: string; calls: number }[] }, { agents: { id: string; name: string; emoji: string; calls: number; successRate: number | null }[] }]) => {
        setRealStats(rangeData);
        setAllStats(allData);
        setTopSessions(topData);
        setSkillStats({ total: skillData.total, prevTotal: skillData.prevTotal });
        setSkillStatsList(skillData.skills ?? []);
        setAgentStats(agentData.agents ?? []);
        setStatsLoading(false);
      })
      .catch(() => setStatsLoading(false));
  }, [timeRange]);

  if (statsLoading || !realStats || !allStats) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  const stats = realStats;

  const calcTrend = (current: number, prev?: number) => {
    if (!prev || prev === 0) return { value: 0, direction: "flat" as const };
    const change = ((current - prev) / prev) * 100;
    return {
      value: Math.abs(change),
      direction: change > 5 ? "up" as const : change < -5 ? "down" as const : "flat" as const,
    };
  };

  const isRealtime = timeRange === "realtime";
  const hasCritical = stats.anomalies?.some((a) => a.severity === "critical") ?? false;
  const criticalCount = stats.anomalies?.filter((a) => a.severity === "critical").length ?? 0;
  const warningCount = stats.anomalies?.filter((a) => a.severity === "warning").length ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="概览仪表盘"
        description={isRealtime ? "实时运行状态监控" : "Agent 市场近 7 天运行情况"}
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

      {/* 核心指标：大数字 + 紧凑标签 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="活跃 Agent" value={String(stats.activeAgents)} sub={isRealtime ? "今日运行中" : "本周活跃"} trend={calcTrend(stats.activeAgents, stats.prevActiveAgents)} />
        <KpiCard label="Skill 调用" value={formatNumber(skillStats.total)} sub={isRealtime ? "今日累计" : "本周累计"} trend={calcTrend(skillStats.total, skillStats.prevTotal)} />
        <KpiCard label="Session 总数" value={String(stats.totalSessions)} sub={isRealtime ? "今日新增" : "本周新增"} trend={calcTrend(stats.totalSessions, stats.prevTotalSessions)} />
        <KpiCard label="Token 消耗" value={formatTokens(stats.totalTokens)} sub={isRealtime ? "今日累计" : "本周累计"} trend={calcTrend(stats.totalTokens, stats.prevTotalTokens)} />
      </div>

      {/* 异常预警：语义色只做状态提示 */}
      {stats.anomalies && stats.anomalies.length > 0 && (
        <div className={cnAlert(hasCritical)}>
          <button
            onClick={() => setAlertsExpanded(!alertsExpanded)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <AlertTriangle className={`h-3.5 w-3.5 ${hasCritical ? "text-destructive" : "text-warning"}`} />
              {criticalCount > 0 && <span className="text-destructive tabular-nums">{criticalCount} 项严重异常</span>}
              {criticalCount > 0 && warningCount > 0 && <span className="text-muted-foreground">·</span>}
              {warningCount > 0 && <span className="text-warning tabular-nums">{warningCount} 项警告</span>}
            </span>
            {alertsExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
          {alertsExpanded && (
            <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
              {stats.anomalies.slice(0, 5).map((a, i) => (
                <AnomalyItem key={i} anomaly={a} />
              ))}
              {stats.anomalies.length > 5 && (
                <p className="pl-4 text-xs text-muted-foreground tabular-nums">还有 {stats.anomalies.length - 5} 项异常…</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 主区域：Agent / Skill / Session 三列排行 */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Agent 排行 */}
        <Link href="/agent-stats" className="block">
          <Card className="h-full cursor-pointer transition-colors hover:ring-foreground/25">
            <CardHeader className="border-b border-border/60 pb-2.5">
              <CardTitle>Agent 调用排行</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="grid grid-cols-[16px_1fr_44px_48px] gap-x-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
                <span />
                <span>名称</span>
                <span className="text-right">调用</span>
                <span className="text-right">成功率</span>
              </div>
              <div className="divide-y divide-border/50">
                {agentStats.slice(0, 5).map((agent, i) => (
                  <div key={agent.id} className="grid h-8 grid-cols-[16px_1fr_44px_48px] items-center gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground/60 tabular-nums">{i + 1}</span>
                    <span className="truncate text-[13px]">{agent.name}</span>
                    <span className={numCell}>{formatNumber(agent.calls)}</span>
                    <span className={`${numCell} ${rateColor(agent.successRate)}`}>
                      {agent.successRate != null ? `${agent.successRate}%` : "—"}
                    </span>
                  </div>
                ))}
                {agentStats.length === 0 && <EmptyRow colSpan={4} />}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Skill 排行 */}
        <Link href="/skill-stats" className="block">
          <Card className="h-full cursor-pointer transition-colors hover:ring-foreground/25">
            <CardHeader className="border-b border-border/60 pb-2.5">
              <CardTitle>Skill 调用排行</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="grid grid-cols-[16px_1fr_56px] gap-x-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
                <span />
                <span>名称</span>
                <span className="text-right">调用</span>
              </div>
              <div className="divide-y divide-border/50">
                {skillStatsList.slice(0, 5).map((skill, i) => (
                  <div key={skill.name} className="grid h-8 grid-cols-[16px_1fr_56px] items-center gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground/60 tabular-nums">{i + 1}</span>
                    <span className="truncate text-[13px]">{skill.name}</span>
                    <span className={numCell}>{formatNumber(skill.calls)}</span>
                  </div>
                ))}
                {skillStatsList.length === 0 && <EmptyRow colSpan={3} />}
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Session 排行 */}
        <Link href="/trace" className="block">
          <Card className="h-full cursor-pointer transition-colors hover:ring-foreground/25">
            <CardHeader className="border-b border-border/60 pb-2.5">
              <CardTitle>Session Token 消耗</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="grid grid-cols-[16px_1fr_56px] gap-x-2 pb-1.5 text-[11px] font-medium text-muted-foreground">
                <span />
                <span>会话 / Agent</span>
                <span className="text-right">Token</span>
              </div>
              <div className="divide-y divide-border/50">
                {topSessions.map((s, i) => (
                  <div key={s.id} className="grid h-8 grid-cols-[16px_1fr_56px] items-center gap-x-2">
                    <span className="font-mono text-xs text-muted-foreground/60 tabular-nums">{i + 1}</span>
                    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
                      <span className="font-mono text-xs text-muted-foreground">{s.id.slice(-6)}</span>
                      <span className="truncate text-muted-foreground">{s.agentName}</span>
                    </div>
                    <span className={numCell}>{formatTokens(s.totalTokens)}</span>
                  </div>
                ))}
                {topSessions.length === 0 && <EmptyRow colSpan={3} />}
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 近 7 天视图：Token 消耗趋势 */}
      {!isRealtime && (
        <Card>
          <CardHeader className="border-b border-border/60 pb-2.5">
            <CardTitle>Token 消耗趋势</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.dailyTrend ?? []} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={colors.areaStroke} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={colors.areaStroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} interval="preserveStartEnd" tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: colors.text }} stroke={colors.grid} tickLine={false} tickFormatter={(v) => formatTokens(v)} width={48} />
                  <Tooltip
                    formatter={(value) => [formatTokens(value as number), "Token"]}
                    contentStyle={{ backgroundColor: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: colors.text }}
                    labelStyle={{ fontSize: 11, color: colors.text }}
                  />
                  <Area type="monotone" dataKey="tokens" stroke={colors.areaStroke} fill="url(#tokenGradient)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function rateColor(rate: number | null) {
  if (rate == null) return "text-muted-foreground";
  if (rate >= 97) return "text-success";
  if (rate >= 93) return "text-warning";
  return "text-destructive";
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <div className="flex h-8 items-center" style={{ gridColumn: `span ${colSpan}` }}>
      <p className="w-full text-center text-xs text-muted-foreground">暂无数据</p>
    </div>
  );
}

function cnAlert(hasCritical: boolean) {
  return [
    "rounded-lg px-4 py-3 ring-1",
    hasCritical
      ? "bg-destructive/5 ring-destructive/25"
      : "bg-warning/5 ring-warning/25",
  ].join(" ");
}

function AnomalyItem({ anomaly }: { anomaly: { type: string; severity: "critical" | "warning"; message: string; details?: { sessionId?: string; agentName?: string; tokens?: number; excessPercent?: number; errorRate?: number }[] } }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = anomaly.details && anomaly.details.length > 0;

  return (
    <div>
      <div className="flex items-center gap-2 text-[13px]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${anomaly.severity === "critical" ? "bg-destructive" : "bg-warning"}`} />
        <span className="text-muted-foreground">{anomaly.message}</span>
        {hasDetails && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="ml-3.5 mt-1.5 w-1/2 overflow-hidden rounded-md ring-1 ring-foreground/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground">
                {anomaly.details![0].sessionId != null && (
                  <th className="px-2.5 py-1.5 text-left font-medium">Session ID</th>
                )}
                {anomaly.details![0].agentName != null && (
                  <th className="px-2.5 py-1.5 text-left font-medium">Agent</th>
                )}
                {anomaly.details![0].tokens != null && (
                  <th className="px-2.5 py-1.5 text-right font-medium">Token</th>
                )}
                {anomaly.details![0].excessPercent != null && (
                  <th className="px-2.5 py-1.5 text-right font-medium">超出均值</th>
                )}
                {anomaly.details![0].errorRate != null && (
                  <th className="px-2.5 py-1.5 text-right font-medium">错误率</th>
                )}
              </tr>
            </thead>
            <tbody>
              {anomaly.details!.map((d, i) => (
                <tr key={i} className="border-t border-border/60">
                  {d.sessionId != null && (
                    <td className="px-2.5 py-1.5">
                      <Link
                        href={`/trace?session=${d.sessionId}`}
                        className="font-mono text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {d.sessionId.slice(-6)}
                      </Link>
                    </td>
                  )}
                  {d.agentName != null && <td className="px-2.5 py-1.5">{d.agentName}</td>}
                  {d.tokens != null && <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">{formatTokens(d.tokens)}</td>}
                  {d.excessPercent != null && <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-warning">+{d.excessPercent}%</td>}
                  {d.errorRate != null && <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-destructive">{d.errorRate}%</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
