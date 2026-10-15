"use client";

import { X, BarChart3, FileText, Users, FolderKanban, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlidePanel } from "@/components/trace/slide-panel";
import { formatNumber, formatDuration, formatRelativeTime } from "@/lib/format";
import { useState, useEffect } from "react";

interface SkillDetailData {
  id: string;
  name: string;
  description: string;
  calls: number;
  successRate: number;
  avgLatency: number;
  skillMd: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface UsageData {
  users: { name: string; org: string; calls: number; lastUsed: string }[];
  projects: { name: string; calls: number; lastUsed: string }[];
  agents: { name: string; emoji: string; calls: number; lastUsed: string }[];
  total: number;
}

interface Props {
  skill: SkillDetailData | null;
  open: boolean;
  onClose: () => void;
  timeRange: "realtime" | "weekly";
}

export function SkillDetailPanel({ skill, open, onClose, timeRange }: Props) {
  const [activeTab, setActiveTab] = useState<"overview" | "skillmd">("overview");
  const [usageRange, setUsageRange] = useState<"realtime" | "weekly">(timeRange);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    if (open && skill && activeTab === "overview") {
      setUsageLoading(true);
      fetch(`/api/skills/${encodeURIComponent(skill.name)}/usage?range=${usageRange}`)
        .then((res) => res.json())
        .then((data) => setUsage(data))
        .catch(() => setUsage(null))
        .finally(() => setUsageLoading(false));
    }
  }, [open, skill, activeTab, usageRange]);

  if (!skill) return null;

  return (
    <SlidePanel open={open} onClose={onClose} width={60}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
            <BarChart3 className="h-4.5 w-4.5" />
          </div>
          <div>
             <h2 className="text-base font-bold">{skill.name}</h2>
             <p className="text-sm text-muted-foreground">v{skill.version ?? 1}</p>
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
             activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("overview")}
        >
          数据概览
        </button>
         <button
           className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
             activeTab === "skillmd"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("skillmd")}
        >
          <FileText className="h-3 w-3" />
          SKILL.md
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {activeTab === "overview" ? (
          <div className="space-y-5 p-5">
            {/* Description */}
            <div>
              <p className="text-sm font-medium text-muted-foreground">描述</p>
              <p className="mt-1 text-sm leading-relaxed">{skill.description}</p>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 gap-3">
              <MetricCard label="调用次数" value={formatNumber(skill.calls)} />
            </div>

            {/* Usage Statistics */}
            <div>
              <div className="flex items-center justify-between mb-3">
                 <p className="text-sm font-medium">使用情况统计</p>
                <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5">
                   <button
                     className={`h-6 px-2 text-xs font-medium rounded transition-colors ${
                       usageRange === "realtime" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                     }`}
                     onClick={() => setUsageRange("realtime")}
                   >
                     今日
                   </button>
                   <button
                     className={`h-6 px-2 text-xs font-medium rounded transition-colors ${
                       usageRange === "weekly" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                     }`}
                     onClick={() => setUsageRange("weekly")}
                   >
                     近7天
                  </button>
                </div>
              </div>

              {usageLoading ? (
                <div className="flex h-[100px] items-center justify-center">
                   <p className="text-sm text-muted-foreground">加载中...</p>
                </div>
              ) : usage && usage.total > 0 ? (
                <div className="space-y-4">
                  {/* Users */}
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
                  {/* Projects */}
                  <UsageTable
                    title="项目"
                    icon={<FolderKanban className="h-3.5 w-3.5 text-green-500" />}
                    items={usage.projects.map((p) => ({
                      name: p.name,
                      calls: p.calls,
                      lastUsed: p.lastUsed,
                    }))}
                  />
                  {/* Agents */}
                  <UsageTable
                    title="Agent"
                    icon={<Bot className="h-3.5 w-3.5 text-purple-500" />}
                    items={usage.agents.map((a) => ({
                      name: `${a.emoji} ${a.name}`,
                      calls: a.calls,
                      lastUsed: a.lastUsed,
                    }))}
                  />
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
                 <InfoRow label="版本" value={`v${skill.version ?? 1}`} />
                <InfoRow label="注册时间" value={skill.createdAt ? new Date(skill.createdAt).toLocaleDateString("zh-CN") : "-"} />
                <InfoRow label="最近更新" value={skill.updatedAt ? new Date(skill.updatedAt).toLocaleDateString("zh-CN") : "-"} />
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
               <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono text-foreground/90">
                {skill.skillMd}
              </pre>
            </div>
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
                   idx === 0
                    ? "bg-yellow-500/20 text-yellow-500"
                    : idx === 1
                      ? "bg-gray-400/20 text-gray-400"
                      : "bg-orange-600/20 text-orange-600"
                }`}
               >
                {idx + 1}
               </span>
               <span className="text-sm font-medium truncate">{item.name}</span>
               {item.subtitle && (
                 <span className="text-xs text-muted-foreground truncate">{item.subtitle}</span>
               )}
            </div>
            <div className="text-right shrink-0 ml-3">
               <p className="text-sm font-mono font-semibold">{formatNumber(item.calls)}次</p>
               <p className="text-xs text-muted-foreground">{formatRelativeTime(new Date(item.lastUsed).getTime())}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
               <p className="text-xs text-muted-foreground">{label}</p>
       <p
         className={`mt-1 text-xl font-bold ${
           accent === "success" ? "text-success" : "text-foreground"
         }`}
       >
         {value }
       </p>
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
