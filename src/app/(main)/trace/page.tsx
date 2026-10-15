"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { RefreshCw, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/trace/shared";
import { TraceViewerPanel } from "@/components/trace/trace-viewer-panel";
import { PageHeader } from "@/components/shell/page-header";
import { KpiCard } from "@/components/shell/kpi-card";
import { formatTokens, formatDuration, formatRelativeTime } from "@/lib/format";

const PAGE_SIZE = 15;

interface SessionItem {
  id: string;
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  userOrg: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  status: string;
  model: string;
  startTime: string;
  totalRounds: number;
  totalSpans: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalDuration: number;
  forkCount: number;
}

export default function TraceListPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedSession, setSelectedSession] = useState<SessionItem | null>(null);

  const loadSessions = useCallback(() => {
    setLoading(true);
    fetch("/api/sessions")
      .then((res) => res.json())
      .then((data) => {
        setSessions(data);
        setLoading(false);
        // 读取 URL 参数自动过滤
        const params = new URLSearchParams(window.location.search);
        const sessionParam = params.get("session");
        if (sessionParam) {
          setSearch(sessionParam);
        }
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleDelete = async (sessionId: string) => {
    if (!confirm("确定删除该 Session 及其所有 Span 数据？")) return;
    const res = await fetch("/api/sessions?id=" + encodeURIComponent(sessionId), { method: "DELETE" });
    if (res.ok) {
      if (selectedSession?.id === sessionId) setSelectedSession(null);
      loadSessions();
    } else {
      alert("删除失败");
    }
  };

  const filtered = useMemo(() => {
    let result = sessions;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q) ||
          s.userName.toLowerCase().includes(q) ||
          s.agentName.toLowerCase().includes(q),
      );
    }
    if (agentFilter !== "all") result = result.filter((s) => s.agentId === agentFilter);
    if (statusFilter !== "all") result = result.filter((s) => s.status === statusFilter);
    return result;
  }, [sessions, search, agentFilter, statusFilter]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const totalSessions = sessions.length;
  const totalErrors = sessions.reduce((sum, s) => sum + s.errorCount, 0);
  const totalSpans = sessions.reduce((sum, s) => sum + s.totalSpans, 0);
  const errorRate = totalSpans > 0 ? ((totalErrors / totalSpans) * 100).toFixed(1) : "0.0";
  const totalTokens = sessions.reduce((s, x) => s + x.totalTokens, 0);
  const totalDuration = sessions.reduce((s, x) => s + x.totalDuration, 0);
  const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] gap-5 p-6">
      <PageHeader
        title="链路追踪"
        description="观测 Agent 市场全链路执行，定位瓶颈与异常"
        actions={
          <Button variant="outline" size="sm" onClick={loadSessions}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Session 总数" value={String(totalSessions)} sub="累计" />
        <KpiCard label="平均耗时" value={formatDuration(Math.round(avgDuration))} sub="每个 Session 均值" />
        <KpiCard
          label="错误率"
          value={`${errorRate}%`}
          sub="占总 Span 比例"
          subTone={Number(errorRate) > 1 ? "warning" : "success"}
        />
        <KpiCard label="总 Token" value={formatTokens(totalTokens)} sub="累计消耗" />
      </div>

      {/* Filters */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜索 Session ID、项目、用户、Agent..."
            className="h-8 pl-8"
          />
        </div>
        <Select value={agentFilter} onValueChange={(v) => { setAgentFilter(v ?? "all"); setPage(1); }}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部 Agent</SelectItem>
            {Array.from(new Set(sessions.map((s) => s.agentId))).map((agentId) => {
              const agent = sessions.find((s) => s.agentId === agentId);
              return (
                <SelectItem key={agentId} value={agentId}>
                  {agent?.agentName}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? "all"); setPage(1); }}>
          <SelectTrigger className="h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">活跃</SelectItem>
            <SelectItem value="completed">完成</SelectItem>
            <SelectItem value="error">异常</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Slide-in Detail Panel */}
      <TraceViewerPanel
        session={selectedSession}
        open={selectedSession !== null}
        onClose={() => setSelectedSession(null)}
      />

      {/* Session Table */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <Table>
            <TableHeader className="sticky top-0 z-10">
               <TableRow className="bg-card hover:bg-card">
                 <TableHead className="w-[110px] text-xs">Session ID</TableHead>
                 <TableHead className="w-[140px] text-xs">Agent</TableHead>
                 <TableHead className="w-[90px] text-xs">用户</TableHead>
                 <TableHead className="w-[120px] text-xs">项目</TableHead>
                 <TableHead className="w-[60px] text-center text-xs">轮次</TableHead>
                 <TableHead className="w-[70px] text-center text-xs">Span</TableHead>
                 <TableHead className="w-[60px] text-center text-xs">错误</TableHead>
                 <TableHead className="w-[80px] text-right text-xs">Token</TableHead>
                 <TableHead className="w-[80px] text-right text-xs">耗时</TableHead>
                 <TableHead className="w-[80px] text-center text-xs">状态</TableHead>
                 <TableHead className="w-[80px] text-right text-xs">时间</TableHead>
                 <TableHead className="w-[60px] text-center text-xs">操作</TableHead>
               </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/60">
              {paged.map((session) => (
                <TableRow
                  key={session.id}
                  className="h-11 cursor-pointer transition-colors hover:bg-muted/30"
                  onClick={() => setSelectedSession(session)}
                >
                   <TableCell className="font-mono text-xs text-muted-foreground">{session.id}</TableCell>
                  <TableCell>
                    <span className="text-[13px] font-medium">{session.agentName}</span>
                  </TableCell>
                   <TableCell className="text-[13px]">{session.userName}</TableCell>
                   <TableCell className="text-[13px] text-muted-foreground">{session.projectName}</TableCell>
                   <TableCell className="text-center font-mono text-[13px] tabular-nums">{session.totalRounds}</TableCell>
                   <TableCell className="text-center font-mono text-[13px] tabular-nums">{session.totalSpans}</TableCell>
                   <TableCell className="text-center">
                     {session.errorCount > 0 ? (
                       <span className="font-mono text-[13px] font-medium tabular-nums text-destructive">{session.errorCount}</span>
                     ) : (
                       <span className="text-[13px] text-muted-foreground">0</span>
                     )}
                   </TableCell>
                   <TableCell className="text-right font-mono text-[13px] tabular-nums">{formatTokens(session.totalTokens)}</TableCell>
                   <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                     {formatDuration(session.totalDuration)}
                   </TableCell>
                  <TableCell className="text-center">
                    <StatusBadge status={session.status as "active" | "completed" | "error"} />
                  </TableCell>
                   <TableCell className="text-right text-xs text-muted-foreground">
                     {formatRelativeTime(new Date(session.startTime).getTime())}
                   </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-card px-4 py-2.5">
           <p className="text-xs text-muted-foreground tabular-nums">
             共 <span className="font-medium text-foreground">{filtered.length}</span> 条
           </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <span className="px-2 text-xs text-muted-foreground tabular-nums">{page} / {Math.ceil(filtered.length / PAGE_SIZE) || 1}</span>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={page >= Math.ceil(filtered.length / PAGE_SIZE)} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
