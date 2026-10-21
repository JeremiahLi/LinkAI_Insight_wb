"use client";

import { X, BarChart3, FileText, Users, FolderKanban, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlidePanel } from "@/components/trace/slide-panel";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { UsageTrendChart, type TrendPointDto } from "@/components/charts/usage-trend-chart";
import { RANGED_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";
import { useState, useEffect } from "react";

interface AgentDetailData {
  id: string;
  name: string;
  emoji: string;
  description: string;
  framework: string;
  version: string;
  readme: string;
  calls: number;
  successRate: number | null;
  createdAt?: string;
  updatedAt?: string;
}

interface UsageData {
  users: { name: string; org: string; calls: number; lastUsed: string }[];
  projects: { name: string; calls: number; lastUsed: string }[];
  sessions: { id: string; startTime: string }[];
  total: number;
}

type DetailRange = Exclude<StatsRange, "all">;
type Granularity = "day" | "week";

interface Props {
  agent: AgentDetailData | null;
  open: boolean;
  onClose: () => void;
  timeRange: DetailRange;
}

export function AgentDetailPanel({ agent, open, onClose, timeRange }: Props) {
  const [activeTab, setActiveTab] = useState<"overview" | "readme">("overview");
  const [usageRange, setUsageRange] = useState<DetailRange>(timeRange);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [trend, setTrend] = useState<TrendPointDto[]>([]);

  const [agentStats, setAgentStats] = useState<{ calls: number; sessions: number; successRate: number | null }>({ calls: agent?.calls ?? 0, sessions: agent?.calls ?? 0, successRate: agent?.successRate ?? null });

  useEffect(() => {
    if (open && agent) {
      // 使用情况统计
      if (activeTab === "overview") {
        setUsageLoading(true);
        fetch(`/api/agents/${encodeURIComponent(agent.name)}/usage?range=${usageRange}`)
          .then((res) => res.json())
          .then((data) => setUsage(data))
          .catch(() => setUsage(null))
          .finally(() => setUsageLoading(false));

        // 使用趋势
        fetch(`/api/dashboard/agents/${encodeURIComponent(agent.name)}/trend?range=${usageRange}&granularity=${granularity}`)
          .then((res) => res.json())
          .then((data) => setTrend(data.trend ?? []))
          .catch(() => setTrend([]));
      }
      // 调用次数和成功率
      fetch(`/api/agents/${encodeURIComponent(agent.name)}/stats?range=${usageRange}`)
        .then((res) => res.json())
        .then((data) => setAgentStats({ calls: data.calls, sessions: data.sessions, successRate: data.successRate }))
        .catch(() => setAgentStats({ calls: 0, sessions: 0, successRate: null }));
    }
  }, [open, agent, activeTab, usageRange, granularity]);

  if (!agent) return null;

  return (
    <SlidePanel open={open} onClose={onClose} width={60}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <BarChart3 className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-bold">{agent.name}</h2>
            <p className="text-sm text-muted-foreground">v{agent.version}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-5">
        <button
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            activeTab === "overview" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("overview")}
        >
          数据概览
        </button>
        <button
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            activeTab === "readme" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("readme")}
        >
          <FileText className="h-3 w-3" />
          README
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {activeTab === "overview" ? (
          <div className="space-y-5 p-5">
            {/* Description */}
            <div>
              <p className="text-sm font-medium text-muted-foreground">描述</p>
              <p className="mt-1 text-sm leading-relaxed">{agent.description}</p>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-3 gap-3">
              <MetricCard label="调用次数" value={formatNumber(agentStats.calls)} />
              <MetricCard label="Session 数" value={formatNumber(agentStats.sessions)} />
              <MetricCard label="成功率" value={agentStats.successRate != null ? `${agentStats.successRate}%` : "—"} accent="success" />
            </div>

            {/* Usage Statistics */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium">使用情况统计</p>
                <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5">
                  {RANGED_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`h-6 px-2 text-xs font-medium rounded transition-colors ${
                        usageRange === opt.value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => setUsageRange(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 使用趋势图 */}
              <div className="mb-4 rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">使用趋势</p>
                  <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5">
                    {([["day", "每天"], ["week", "每周"]] as const).map(([key, label]) => (
                      <button
                        key={key}
                        className={`h-6 px-2 text-xs font-medium rounded transition-colors ${
                          granularity === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setGranularity(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <UsageTrendChart data={trend} secondaryName="活跃用户数" height={200} />
              </div>

              {usageLoading ? (
                <div className="flex h-[100px] items-center justify-center">
                  <p className="text-sm text-muted-foreground">加载中...</p>
                </div>
              ) : usage && usage.total > 0 ? (
                <div className="space-y-4">
                  <UsageTable
                    title="用户"
                    icon={<Users className="h-3.5 w-3.5 text-blue-500" />}
                    items={usage.users.map((u) => ({
                      name: u.name,
                      subtitle: u.org,
                      calls: u.calls,
                      lastUsed: u.lastUsed,
                    }))}
                  />
                  <UsageTable
                    title="项目"
                    icon={<FolderKanban className="h-3.5 w-3.5 text-green-500" />}
                    items={usage.projects.map((p) => ({
                      name: p.name,
                      calls: p.calls,
                      lastUsed: p.lastUsed,
                    }))}
                  />
                  {usage.sessions && usage.sessions.length > 0 && (
                    <UsageTable
                      title="Session"
                      icon={<Activity className="h-3.5 w-3.5 text-blue-500" />}
                      items={usage.sessions.map((s) => ({
                        name: s.id,
                        subtitle: undefined,
                        calls: 0,
                        lastUsed: s.startTime,
                      }))}
                    />
                  )}
                </div>
              ) : (
                <div className="flex h-[100px] items-center justify-center rounded-lg border border-border bg-muted/20">
                  <p className="text-sm text-muted-foreground">暂无使用数据</p>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">基本信息</p>
              <div className="rounded-lg border border-border divide-y divide-border">
                <InfoRow label="框架" value={agent.framework} />
                <InfoRow label="版本" value={`v${agent.version}`} />
                <InfoRow label="注册时间" value={agent.createdAt ? new Date(agent.createdAt).toLocaleDateString("zh-CN") : "-"} />
                <InfoRow label="最近更新" value={agent.updatedAt ? new Date(agent.updatedAt).toLocaleDateString("zh-CN") : "-"} />
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5">
            {agent.readme ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-foreground/90">
                  {agent.readme}
                </pre>
              </div>
            ) : (
              <div className="flex h-[200px] items-center justify-center rounded-lg border border-border bg-muted/20">
                <p className="text-sm text-muted-foreground">暂无 README</p>
              </div>
            )}
          </div>
        )}
      </div>
    </SlidePanel>
  );
}

function UsageTable({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: { name: string; subtitle?: string; calls: number; lastUsed: string }[];
}) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 bg-muted/30 px-3 py-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">TOP {items.length}</span>
      </div>
      <div className="divide-y divide-border">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold shrink-0 ${
                  idx === 0 ? "bg-yellow-500/20 text-yellow-500"
                    : idx === 1 ? "bg-gray-400/20 text-gray-400"
                    : "bg-orange-600/20 text-orange-600"
                }`}
              >
                {idx + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                {item.subtitle && <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>}
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
               {item.calls > 0 && <p className="text-sm font-mono font-semibold">{formatNumber(item.calls)}次</p>}
               <p className="text-xs text-muted-foreground">{formatRelativeTime(new Date(item.lastUsed).getTime())}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent === "success" ? "text-success" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
