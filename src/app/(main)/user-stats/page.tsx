"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, SegmentedControl } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatTokens } from "@/lib/format";
import { RANGE_OPTIONS, type StatsRange } from "@/lib/engine/stats/range";

interface UserRow {
  name: string;
  sessions: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  rounds: number;
  errors: number;
  errorSessions: number;
  agentCount: number;
  inputCount: number;
  inputChars: number;
}

export default function UserStatsPage() {
  const [timeRange, setTimeRange] = useState<StatsRange>("all");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rangeLabel, setRangeLabel] = useState("全部");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard/users?range=${timeRange}`)
      .then((r) => r.json())
      .then((data) => {
        setUsers(data.users ?? []);
        setRangeLabel(data.range ?? "");
      })
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [timeRange]);

  const totalSessions = users.reduce((a, u) => a + u.sessions, 0);
  const totalTokens = users.reduce((a, u) => a + u.tokens, 0);
  const totalRounds = users.reduce((a, u) => a + u.rounds, 0);
  const maxTokens = Math.max(...users.map((u) => u.tokens), 1);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="用户统计"
        description={`各用户使用 Agent 的情况对比（${rangeLabel}）`}
        actions={
          <SegmentedControl
            options={RANGE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={timeRange}
            onChange={setTimeRange}
          />
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="活跃用户" value={String(users.length)} sub={rangeLabel} />
        <KpiCard label="会话总数" value={formatNumber(totalSessions)} sub="所有用户合计" />
        <KpiCard label="Token 总消耗" value={formatTokens(totalTokens)} sub="所有用户合计" />
        <KpiCard label="对话总轮数" value={formatNumber(totalRounds)} sub="所有用户合计" />
      </div>

      {/* 对比表 */}
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b border-border/60 pb-2.5">
          <CardTitle>用户对比</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中...</p>
          ) : users.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">该时间段暂无数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">用户</TableHead>
                  <TableHead className="text-right">会话数</TableHead>
                  <TableHead className="text-right">Token 消耗</TableHead>
                  <TableHead className="text-right">输入 Token</TableHead>
                  <TableHead className="text-right">输出 Token</TableHead>
                  <TableHead className="text-right">对话轮数</TableHead>
                  <TableHead className="text-right">使用 Agent 数</TableHead>
                  <TableHead className="text-right">输入资料大小*</TableHead>
                  <TableHead className="text-right">异常会话</TableHead>
                  <TableHead className="w-[140px]">Token 占比</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.name} className="cursor-pointer hover:bg-muted/30">
                    <TableCell>
                      <Link
                        href={`/user-stats/${encodeURIComponent(u.name)}`}
                        className="font-medium hover:underline"
                      >
                        {u.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatNumber(u.sessions)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatTokens(u.tokens)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{formatTokens(u.inputTokens)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{formatTokens(u.outputTokens)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatNumber(u.rounds)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{u.agentCount}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums" title="按该用户输入文本的字符数估算">
                      {formatNumber(u.inputCount)} 条 / {formatNumber(u.inputChars)} 字符
                    </TableCell>
                    <TableCell className="text-right">
                      {u.errorSessions > 0 ? (
                        <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums text-destructive">
                          {u.errorSessions}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${(u.tokens / maxTokens) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {Math.round((u.tokens / maxTokens) * 100)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            * 输入资料大小按该用户输入文本的字符数估算（采集端暂未记录原始文件大小）。点击用户名查看单用户下钻明细。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
