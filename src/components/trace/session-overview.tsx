"use client";

import { Layers, Wrench, BookOpen, Brain, Coins, Clock, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatTokens, formatDuration } from "@/lib/format";
import { isSkillSpan } from "./span-kind-icon";
import type { SessionOverviewData } from "./types";

interface Props {
  session: SessionOverviewData;
}

export function SessionOverview({ session }: Props) {
  const allSpans = session.rounds.flatMap((r) => [
    ...r.turns.flatMap((t) => t.spans),
    ...(r.branches?.flatMap((b) => b.spans) ?? []),
  ]);

  const toolCalls = allSpans.filter((s) => s.kind === "tool_call" && !isSkillSpan(s));
  const skillCalls = allSpans.filter((s) => s.kind === "tool_call" && isSkillSpan(s));
  const llmCalls = allSpans.filter((s) => s.kind === "llm_thinking");
  const errors = allSpans.filter((s) => s.status === "failed");
  const totalInputTokens = allSpans.reduce((sum, s) => sum + (s.tokens?.input ?? 0), 0);
  const totalOutputTokens = allSpans.reduce((sum, s) => sum + (s.tokens?.output ?? 0), 0);
  const totalCacheReadTokens = allSpans.reduce((sum, s) => sum + (s.tokens?.cacheRead ?? 0), 0);
  const totalCacheWriteTokens = allSpans.reduce((sum, s) => sum + (s.tokens?.cacheWrite ?? 0), 0);
  const totalTokens = allSpans.reduce((sum, s) => sum + (s.tokens?.total ?? 0), 0);

  // Per-round token data for chart
  const roundTokenData = session.rounds.map((round) => {
    const roundSpans = [...round.turns.flatMap((t) => t.spans), ...(round.branches?.flatMap((b) => b.spans) ?? [])];
    const input = roundSpans.reduce((sum, s) => sum + (s.tokens?.input ?? 0), 0);
    const output = roundSpans.reduce((sum, s) => sum + (s.tokens?.output ?? 0), 0);
    const cacheRead = roundSpans.reduce((sum, s) => sum + (s.tokens?.cacheRead ?? 0), 0);
    const cacheWrite = roundSpans.reduce((sum, s) => sum + (s.tokens?.cacheWrite ?? 0), 0);
    const total = roundSpans.reduce((sum, s) => sum + (s.tokens?.total ?? 0), 0);
    return { name: `R${round.index}`, input, output, cacheRead, cacheWrite, total };
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
            <Layers className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
             <h3 className="text-base font-semibold">Session 概览</h3>
             <p className="text-sm text-muted-foreground">{session.id} · {session.totalRounds} 轮对话</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-4">
        {/* Token 消耗 */}
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="h-3.5 w-3.5 text-violet-500" />
             <span className="text-sm font-semibold text-violet-500">Token 消耗</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            <div className="text-center">
               <p className="text-xl font-bold">{formatTokens(totalInputTokens)}</p>
               <p className="text-xs text-muted-foreground">Input</p>
             </div>
             <div className="text-center">
               <p className="text-xl font-bold">{formatTokens(totalOutputTokens)}</p>
               <p className="text-xs text-muted-foreground">Output</p>
             </div>
             <div className="text-center">
               <p className="text-xl font-bold">{formatTokens(totalCacheReadTokens)}</p>
               <p className="text-xs text-muted-foreground">Cache R</p>
             </div>
             <div className="text-center">
               <p className="text-xl font-bold">{formatTokens(totalCacheWriteTokens)}</p>
               <p className="text-xs text-muted-foreground">Cache W</p>
             </div>
             <div className="text-center">
               <p className="text-xl font-bold text-violet-500">{formatTokens(totalTokens)}</p>
               <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </div>

        {/* Token Trend Chart */}
        {roundTokenData.length > 1 && (
          <div className="rounded-lg border border-border p-3">
             <p className="text-sm font-medium text-muted-foreground mb-2">每轮 Token 趋势</p>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={roundTokenData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                   <XAxis dataKey="name" tick={{ fontSize: 13, fill: "var(--muted-foreground)" }} />
                   <YAxis tick={{ fontSize: 13, fill: "var(--muted-foreground)" }} width={45} />
                   <Tooltip
                     contentStyle={{ fontSize: 14, borderRadius: 8, border: "1px solid var(--border)" }}
                    formatter={(value) => formatTokens(Number(value))}
                  />
                  <Line type="monotone" dataKey="input" stroke="oklch(0.62 0.2 272)" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="output" stroke="oklch(0.72 0.15 70)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
             <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" />Input</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />Output</span>
            </div>
          </div>
        )}

        {/* 调用统计 */}
        <div className="rounded-lg border border-border p-3">
           <p className="text-sm font-medium text-muted-foreground mb-3">调用统计</p>
          <div className="space-y-2.5">
            <StatRow icon={<Wrench className="h-3.5 w-3.5 text-amber-500" />} label="工具调用" value={`${toolCalls.length}`} />
            <StatRow icon={<BookOpen className="h-3.5 w-3.5 text-pink-500" />} label="Skill 使用" value={`${skillCalls.length}`} />
            <StatRow icon={<Brain className="h-3.5 w-3.5 text-violet-500" />} label="LLM 推理" value={`${llmCalls.length}`} />
            <StatRow icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />} label="错误数" value={`${errors.length}`} highlight={errors.length > 0} />
          </div>
        </div>

        {/* 运行信息 */}
        <div className="rounded-lg border border-border p-3">
           <p className="text-sm font-medium text-muted-foreground mb-3">运行信息</p>
           <div className="space-y-2 text-sm">
            <InfoRow label="总轮次" value={`${session.totalRounds} rounds`} />
            <InfoRow label="总 Span" value={`${session.totalSpans} spans`} />
            <InfoRow label="总耗时" value={formatDuration(session.totalDuration)} />
            <InfoRow label="模型" value={session.model} />
            <InfoRow label="状态" value={session.status === "active" ? "活跃" : session.status === "error" ? "异常" : "完成"} />
          </div>
        </div>

        {/* 错误详情 */}
        {errors.length > 0 && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
               <span className="text-sm font-semibold text-destructive">错误 Span</span>
            </div>
            <div className="space-y-1.5">
               {errors.map((span) => (
                 <div key={span.id} className="flex items-center gap-2 text-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  <span className="truncate">{span.name}</span>
                  <span className="ml-auto text-muted-foreground shrink-0">{span.error?.slice(0, 30)}...</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatRow({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon}
       <span className="text-sm flex-1">{label}</span>
      <span className={`text-sm font-bold ${highlight ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
