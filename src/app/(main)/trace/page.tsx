"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2, Search, FlaskConical } from "lucide-react";
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
import { OutcomeBadge } from "@/components/trace/shared";
import { SampleToExperimentPanel } from "@/components/trace/sample-to-experiment-panel";
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
  /** 会话标题（首条用户诉求），空串时前端回退为短 ID */
  title: string;
  /** success / partial / failed / 空串=未知 */
  outcome: string;
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
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [timeWindow, setTimeWindow] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [samplePanelOpen, setSamplePanelOpen] = useState(false);

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
          (s.title ?? "").toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q) ||
          s.userName.toLowerCase().includes(q) ||
          s.agentName.toLowerCase().includes(q),
      );
    }
    if (agentFilter !== "all") result = result.filter((s) => s.agentId === agentFilter);
    if (statusFilter !== "all") {
      // 按终态筛选：success/partial/failed 走 outcome，active 走 status
      result =
        statusFilter === "active"
          ? result.filter((s) => s.status === "active")
          : result.filter((s) => s.outcome === statusFilter);
    }
    if (timeWindow !== "all") {
      const now = Date.now();
      result = result.filter((s) => {
        const t = new Date(s.startTime).getTime();
        if (timeWindow === "custom") {
          if (customStart) {
            const start = new Date(`${customStart}T00:00:00`).getTime();
            if (t < start) return false;
          }
          if (customEnd) {
            const end = new Date(`${customEnd}T23:59:59.999`).getTime();
            if (t > end) return false;
          }
          return true;
        }
        const days = Number(timeWindow);
        return t >= now - days * 86400000;
      });
    }
    if (errorsOnly) result = result.filter((s) => s.errorCount > 0);
    return result;
  }, [sessions, search, agentFilter, statusFilter, timeWindow, customStart, customEnd, errorsOnly]);

  // 筛选变化时，同步清掉已不在筛选结果里的选中项
  useEffect(() => {
    setSelectedIds((prev) => {
      const ids = new Set(filtered.map((s) => s.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const pagedAllSelected = paged.length > 0 && paged.every((s) => selectedIds.has(s.id));
  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (pagedAllSelected) paged.forEach((s) => next.delete(s.id));
      else paged.forEach((s) => next.add(s.id));
      return next;
    });
  };

  const selectedSessions = useMemo(
    () => sessions.filter((s) => selectedIds.has(s.id)),
    [sessions, selectedIds]
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
          label="Span 失败率"
          value={`${errorRate}%`}
          sub="过程失败占比，不等于会话失败"
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
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">进行中</SelectItem>
            <SelectItem value="success">成功</SelectItem>
            <SelectItem value="partial">部分成功</SelectItem>
            <SelectItem value="failed">失败</SelectItem>
          </SelectContent>
        </Select>
        <Select value={timeWindow} onValueChange={(v) => { setTimeWindow(v ?? "all"); setPage(1); }}>
          <SelectTrigger className="h-8 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部时间</SelectItem>
            <SelectItem value="1">近 1 天</SelectItem>
            <SelectItem value="7">近 7 天</SelectItem>
            <SelectItem value="30">近 30 天</SelectItem>
            <SelectItem value="custom">自定义</SelectItem>
          </SelectContent>
        </Select>
        {timeWindow === "custom" && (
          <>
            <Input
              type="date"
              value={customStart}
              onChange={(e) => { setCustomStart(e.target.value); setPage(1); }}
              className="h-8 w-[140px]"
            />
            <span className="text-xs text-muted-foreground">至</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => { setCustomEnd(e.target.value); setPage(1); }}
              className="h-8 w-[140px]"
            />
          </>
        )}
        <button
          onClick={() => { setErrorsOnly((v) => !v); setPage(1); }}
          className={`h-8 rounded-md px-3 text-xs transition-colors ${
            errorsOnly
              ? "bg-destructive/10 text-destructive ring-1 ring-destructive/40"
              : "bg-muted/40 text-muted-foreground ring-1 ring-foreground/10 hover:ring-foreground/25"
          }`}
        >
          仅看过程失败
        </button>
        <div className="flex-1" />
        <Button
          size="sm"
          className="h-8"
          disabled={selectedIds.size === 0}
          onClick={() => setSamplePanelOpen(true)}
        >
          <FlaskConical className="h-3.5 w-3.5" />
          抽样到实验({selectedIds.size})
        </Button>
      </div>

      {/* 抽样到实验弹层 */}
      <SampleToExperimentPanel
        open={samplePanelOpen}
        onClose={() => setSamplePanelOpen(false)}
        sessions={selectedSessions.map((s) => ({ id: s.id, agentId: s.agentId, agentName: s.agentName }))}
        onDone={() => setSelectedIds(new Set())}
      />

      {/* Session Table */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {/* table-fixed：标题列的 truncate 需要固定布局才生效，否则长路径会把整表撑出容器 */}
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 z-10">
               <TableRow className="bg-card hover:bg-card">
                 <TableHead className="w-[40px] text-center">
                   <button
                     onClick={(e) => { e.stopPropagation(); toggleSelectPage(); }}
                     aria-label="全选当前页"
                     className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                       pagedAllSelected
                         ? "border-primary bg-primary text-primary-foreground"
                         : "border-foreground/30 hover:border-foreground/60"
                     }`}
                   >
                     {pagedAllSelected && (
                       <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                         <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                       </svg>
                     )}
                   </button>
                 </TableHead>
                <TableHead className="w-[86px] text-xs">Session</TableHead>
                <TableHead className="w-[260px] text-xs">任务</TableHead>
                <TableHead className="w-[120px] text-xs">Agent</TableHead>
                <TableHead className="w-[80px] text-xs">用户</TableHead>
                <TableHead className="w-[100px] text-xs">项目</TableHead>
                <TableHead className="w-[56px] text-center text-xs">轮次</TableHead>
                <TableHead className="w-[60px] text-center text-xs">Span</TableHead>
                <TableHead className="w-[56px] text-center text-xs">过程失败</TableHead>
                <TableHead className="w-[76px] text-right text-xs">Token</TableHead>
                <TableHead className="w-[76px] text-right text-xs">耗时</TableHead>
                <TableHead className="w-[84px] text-center text-xs">结果</TableHead>
                <TableHead className="w-[76px] text-right text-xs">时间</TableHead>
                <TableHead className="w-[56px] text-center text-xs">操作</TableHead>
               </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/60">
              {paged.map((session) => (
                <TableRow
                  key={session.id}
                  className="h-11 cursor-pointer transition-colors hover:bg-muted/30"
                  onClick={() => router.push(`/trace/${session.id}`)}
                >
                   <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                     <button
                       onClick={(e) => { e.stopPropagation(); toggleSelect(session.id); }}
                       aria-label="选择该 Session"
                       className={`mx-auto flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                         selectedIds.has(session.id)
                           ? "border-primary bg-primary text-primary-foreground"
                           : "border-foreground/30 hover:border-foreground/60"
                       }`}
                     >
                       {selectedIds.has(session.id) && (
                         <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                           <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                         </svg>
                       )}
                     </button>
                   </TableCell>
                   <TableCell className="font-mono text-[11px] text-muted-foreground" title={session.id}>
                     {session.id.slice(0, 8)}
                   </TableCell>
                   <TableCell>
                     {session.title ? (
                       <span className="line-clamp-1 text-[13px]" title={session.title}>
                         {session.title}
                       </span>
                     ) : (
                       <span className="text-[13px] text-muted-foreground/60">（无标题）</span>
                     )}
                   </TableCell>
                  <TableCell>
                    <span className="text-[13px] font-medium">{session.agentName}</span>
                  </TableCell>
                   <TableCell className="text-[13px]">{session.userName}</TableCell>
                   <TableCell className="text-[13px] text-muted-foreground">{session.projectName}</TableCell>
                   <TableCell className="text-center font-mono text-[13px] tabular-nums">{session.totalRounds}</TableCell>
                   <TableCell className="text-center font-mono text-[13px] tabular-nums">{session.totalSpans}</TableCell>
                   <TableCell className="text-center">
                     {session.errorCount > 0 ? (
                       <span
                         className="font-mono text-[13px] font-medium tabular-nums text-warning"
                         title="过程中失败的 span 数（工具重试、质检回流等），不代表会话失败"
                       >
                         {session.errorCount}
                       </span>
                     ) : (
                       <span className="text-[13px] text-muted-foreground">0</span>
                     )}
                   </TableCell>
                   <TableCell className="text-right font-mono text-[13px] tabular-nums">{formatTokens(session.totalTokens)}</TableCell>
                   <TableCell className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                     {formatDuration(session.totalDuration)}
                   </TableCell>
                  <TableCell className="text-center">
                    <OutcomeBadge outcome={session.outcome} status={session.status} />
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
