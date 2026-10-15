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
} from "recharts";
import { formatNumber } from "@/lib/format";
import { useChartColors } from "@/lib/use-chart-colors";
import { SkillDetailPanel } from "@/components/skill/skill-detail-panel";

type TimeRange = "realtime" | "weekly";

export default function SkillStatsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("realtime");
  const [selectedSkill, setSelectedSkill] = useState<{ id: string; name: string; description: string; version: number; calls: number } | null>(null);
  const colors = useChartColors();

  // 从数据库获取真实的调用次数
  const [statsData, setStatsData] = useState<{ total: number; prevTotal: number; skills: { id: string; name: string; description: string; version: number; calls: number }[] }>({ total: 0, prevTotal: 0, skills: [] });
  const [statsLoading, setStatsLoading] = useState(true);

  // 页面加载时同步 skill 注册
  useEffect(() => {
    fetch("/api/skills/sync", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    setStatsLoading(true);
    fetch(`/api/skills/stats?range=${timeRange}`)
      .then((r) => r.json())
      .then((data) => setStatsData(data))
      .catch(() => setStatsData({ total: 0, prevTotal: 0, skills: [] }))
      .finally(() => setStatsLoading(false));
  }, [timeRange]);

  // 合并 skill 元数据 + 真实调用次数
  const skills = [...statsData.skills].sort((a, b) => b.calls - a.calls);

  const chartData = skills.slice(0, 5).map((skill) => ({
    name: skill.name,
    calls: skill.calls,
  }));

  if (statsLoading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Skill 使用看板"
        description="各 Skill 调用次数与排行"
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-2">
        <KpiCard label="Skill 总数" value={String(skills.length)} sub="已注册 Skill" />
        <KpiCard
          label="总调用次数"
          value={formatNumber(statsData.total)}
          sub={timeRange === "realtime" ? "今日累计" : "本周累计"}
        />
      </div>

      {/* Top 5 Skill 调用次数 */}
      <Card>
        <CardHeader className="border-b border-border/60 pb-2.5">
          <CardTitle>Skill 调用次数 Top 5</CardTitle>
        </CardHeader>
        <CardContent className="h-[220px] pt-4">
          {chartData.length > 0 && chartData.some((d) => d.calls > 0) ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={colors.grid} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: colors.text }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  width={200}
                  tick={<CustomTick fill={colors.text} />}
                />
                <Tooltip
                  cursor={{ fill: colors.grid, opacity: 0.4 }}
                  contentStyle={{ backgroundColor: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: colors.text }}
                  itemStyle={{ color: colors.text }}
                  labelStyle={{ color: colors.text }}
                  formatter={(value) => [formatNumber(value as number), "调用次数"]}
                />
                <Bar dataKey="calls" radius={[0, 3, 3, 0]} barSize={16}>
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={colors.bars[index % colors.bars.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">暂无调用数据</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Skill Cards Grid */}
      <div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {skills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} onClick={() => setSelectedSkill(skill)} />
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedSkill && (
        <SkillDetailPanel
          skill={{
            ...selectedSkill,
            successRate: 0,
            avgLatency: 0,
            skillMd: "",
          }}
          open={selectedSkill !== null}
          onClose={() => setSelectedSkill(null)}
          timeRange={timeRange}
        />
      )}
    </div>
  );
}

function SkillCard({ skill, onClick }: { skill: { id: string; name: string; description: string; version: number; calls: number }; onClick: () => void }) {
  return (
    <Card className="flex h-full cursor-pointer flex-col gap-3 p-4 transition-colors hover:ring-foreground/25" onClick={onClick}>
      {/* Header: Name + Version */}
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold">{skill.name}</p>
        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          v{skill.version ?? 1}
        </span>
      </div>

      {/* Description */}
      <p className="line-clamp-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">{skill.description}</p>

      {/* Calls */}
      <div className="mt-auto flex items-baseline justify-between border-t border-border/60 pt-3">
        <span className="text-[11px] text-muted-foreground">调用次数</span>
        <span className="font-mono text-base font-semibold tabular-nums tracking-tight">{formatNumber(skill.calls)}</span>
      </div>
    </Card>
  );
}

function CustomTick(props: { x?: number; y?: number; payload?: { value: string }; fill?: string }) {
  const { y = 0, payload, fill } = props;
  const text = payload?.value || "";
  return (
    <text y={y} dy={4} textAnchor="start" fill={fill} fontSize={12}>
      <tspan x={4}>{text}</tspan>
    </text>
  );
}
