"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { X, Maximize2, Minimize2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SlidePanel } from "./slide-panel";
import { TraceTimeline } from "./trace-timeline";
import { TraceTranscript } from "./trace-transcript";
import {
  compressIdleGaps,
  displayDurationMs,
  flattenSession,
  isFailed,
  kindLabel,
  spanColor,
  totalSecondsOf,
  type TraceSpan,
} from "./trace-helpers";
import { formatTokens, formatDuration } from "@/lib/format";
import type { SessionDetail, SpanNode, RoundNode } from "./types";

interface SessionSummary {
  id: string;
  projectId: string;
  projectName: string;
  agentEmoji: string;
  agentName: string;
  userName: string;
}

interface Props {
  session: SessionSummary | null;
  open: boolean;
  onClose: () => void;
}

export function TraceViewerPanel({ session, open, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [view, setView] = useState<"timeline" | "transcript">("timeline");
  const [panelWidth, setPanelWidth] = useState(88);
  const isDraggingWidth = useRef(false);

  useEffect(() => {
    if (session?.id) {
      fetch(`/api/sessions/${session.id}`)
        .then((res) => res.json())
        .then((data) => {
          setDetail(data);
          setSelectedSpanId(null);
          setView("timeline");
        })
        .catch(console.error);
    } else {
      setDetail(null);
    }
  }, [session?.id]);

  const handleWidthMouseDown = useCallback(() => {
    isDraggingWidth.current = true;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingWidth.current) {
        const vw = window.innerWidth;
        const pct = ((vw - e.clientX) / vw) * 100;
        setPanelWidth(Math.min(Math.max(pct, 60), 98));
      }
    };
    const handleMouseUp = () => {
      isDraggingWidth.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const spans = useMemo(
    () => (detail ? compressIdleGaps(flattenSession(detail)) : []),
    [detail],
  );
  const totalSeconds = useMemo(
    () => (detail ? totalSecondsOf(detail, spans) : 0),
    [detail, spans],
  );
  const selectedSpan = useMemo(
    () => spans.find((s) => s.id === selectedSpanId) ?? null,
    [spans, selectedSpanId],
  );

  const llmCount = useMemo(() => spans.filter((s) => s.kind === "llm_thinking").length, [spans]);
  const toolCount = useMemo(
    () => spans.filter((s) => s.kind === "tool_call" || s.kind === "command").length,
    [spans],
  );
  const failedToolCount = useMemo(
    () => spans.filter((s) => (s.kind === "tool_call" || s.kind === "command") && isFailed(s)).length,
    [spans],
  );

  if (!session || !detail) return null;

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      width={panelWidth}
      isFullscreen={isFullscreen}
      minWidth="1100px"
      maxWidth="1760px"
    >
      <div
        onMouseDown={handleWidthMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary/30 transition-colors z-10"
      />

      {/* Header：统计条 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-5">
        <div className="flex min-w-0 items-center gap-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-base shrink-0">{detail.agentEmoji}</span>
            <h1 className="truncate text-base font-semibold tracking-tight">{detail.agentName}</h1>
            <span className="truncate text-sm text-muted-foreground">· {detail.projectName}</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <StatChip label="耗时" value={formatDuration(detail.totalDuration)} />
            <StatChip
              label="In"
              value={formatTokens(detail.totalInputTokens)}
              valueClass="text-[var(--trace-llm)]"
            />
            <StatChip
              label="Out"
              value={formatTokens(detail.totalOutputTokens)}
              valueClass="text-[var(--trace-tool)]"
            />
            <StatChip label="Total" value={formatTokens(detail.totalTokens)} />
            <StatChip label="LLM" value={String(llmCount)} />
            <StatChip
              label="Tool"
              value={
                <>
                  {toolCount}{" "}
                  {failedToolCount > 0 && (
                    <span className="text-destructive">({failedToolCount} failed)</span>
                  )}
                </>
              }
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={detail.status} />
          <div className="mr-1 flex items-center gap-1 rounded-lg bg-muted/50 p-1">
            <Button
              variant={view === "timeline" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setView("timeline")}
            >
              Timeline
            </Button>
            <Button
              variant={view === "transcript" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setView("transcript")}
            >
              Transcript
            </Button>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsFullscreen(!isFullscreen)}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 主体：三栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：Span 层级树 */}
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-card">
          <div className="z-10 border-b border-border bg-card px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Span Hierarchy
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin pb-4">
            <SpanTree
              detail={detail}
              selectedId={selectedSpanId}
              onSelect={(id) => setSelectedSpanId(id)}
              onDeselect={() => setSelectedSpanId(null)}
            />
          </div>
        </aside>

        {/* 中：Timeline / Transcript */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {view === "timeline" ? (
            <TraceTimeline
              spans={spans}
              totalSeconds={totalSeconds}
              selectedId={selectedSpanId}
              onSelect={setSelectedSpanId}
            />
          ) : (
            <TraceTranscript
              spans={spans}
              selectedId={selectedSpanId}
              onSelect={setSelectedSpanId}
            />
          )}
        </main>

        {/* 右：Span 详情 */}
        <aside className="w-96 shrink-0 overflow-y-auto scrollbar-thin border-l border-border bg-card">
          <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Span 详情
            </h2>
          </div>
          <div className="p-4 text-sm">
            {selectedSpan ? (
              <SpanDetails span={selectedSpan} totalSeconds={totalSeconds} />
            ) : (
              <p className="text-muted-foreground">点击左侧树或 Timeline 中的条查看详情</p>
            )}
          </div>
        </aside>
      </div>
    </SlidePanel>
  );
}

function StatChip({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono font-medium", valueClass)}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const text = status === "active" ? "Active" : status === "error" ? "Error" : "Completed";
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium",
        status === "active" && "border-[var(--trace-tool)]/40 bg-[var(--trace-tool)]/10 text-[var(--trace-tool)]",
        status === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
        status !== "active" && status !== "error" &&
          "border-[var(--trace-tool)]/40 bg-[var(--trace-tool)]/10 text-[var(--trace-tool)]",
      )}
    >
      {text}
    </span>
  );
}

// ==================== 左侧 Span 层级树 ====================

function SpanTree({
  detail,
  selectedId,
  onSelect,
  onDeselect,
}: {
  detail: SessionDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}) {
  // 折叠的 Round（点击 Round 分组头切换）
  const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(new Set());
  const toggleRound = useCallback((id: string) => {
    setCollapsedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      {/* Session 根节点 */}
      <div
        onClick={onDeselect}
        className={cn(
          "flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 transition-colors",
          selectedId === null ? "bg-primary/10" : "bg-muted/20 hover:bg-muted/30",
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">
          S
        </span>
        <span className="text-sm font-bold">Session</span>
        <span className="text-xs text-muted-foreground">
          {detail.totalRounds} rounds · {detail.totalSpans} spans
        </span>
      </div>

      {detail.rounds.map((round) => (
        <RoundGroup
          key={round.id}
          round={round}
          collapsed={collapsedRounds.has(round.id)}
          onToggle={() => toggleRound(round.id)}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function RoundGroup({
  round,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
}: {
  round: RoundNode;
  collapsed: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const roundSpans: SpanNode[] = [
    ...(round.inputSpan ? [round.inputSpan] : []),
    ...(round.systemPromptSpan ? [round.systemPromptSpan] : []),
    ...round.turns.flatMap((t) => t.spans),
    ...(round.answerSpan ? [round.answerSpan] : []),
  ];
  const roundDurationMs = roundSpans.reduce((sum, s) => sum + displayDurationMs(s), 0);
  const hasError = roundSpans.some(isFailed);

  return (
    <div className="mx-1.5 my-1.5 overflow-hidden rounded-lg border border-primary/25 bg-primary/5">
      {/* Round 分组头（点击折叠/展开） */}
      <div
        onClick={onToggle}
        title={collapsed ? "展开" : "折叠"}
        className="flex cursor-pointer select-none items-center gap-1.5 border-b border-primary/25 bg-primary/10 px-2 py-1.5 text-[11px] font-semibold tracking-wide text-[var(--trace-agent)] hover:brightness-110"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
        <span className="rounded-sm bg-primary/25 px-1.5 py-0.5 text-[9px] font-medium uppercase">
          Round
        </span>
        <span>{round.index}</span>
        {hasError ? (
          <span className="ml-auto text-[11px] text-destructive">✕ FAILED</span>
        ) : (
          <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
            {formatDuration(roundDurationMs)}
          </span>
        )}
      </div>

      {!collapsed && (
        <>
          {roundSpans.map((span) => (
            <TreeItem
              key={span.id}
              span={span}
              depth={0}
              selected={selectedId === span.id}
              onSelect={onSelect}
            />
          ))}

          {/* 分支（Fork）子分组 */}
          {(round.branches ?? []).map((branch) => (
            <div
              key={branch.id}
              className="mx-2 mb-2 overflow-hidden rounded-md border border-dashed border-primary/30"
            >
              <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1 text-[10px] font-medium italic text-[var(--trace-agent)]">
                ⑂ Branch · {branch.name}
              </div>
              {branch.spans.map((span) => (
                <TreeItem
                  key={span.id}
                  span={span}
                  depth={1}
                  selected={selectedId === span.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function TreeItem({
  span,
  depth,
  selected,
  onSelect,
}: {
  span: SpanNode;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const color = spanColor(span);
  const failed = isFailed(span);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect(span.id);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors",
        selected ? "bg-primary/15" : "hover:bg-muted/40",
      )}
      style={{ paddingLeft: `${12 + depth * 14}px` }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className={cn("flex-1 truncate", failed && "font-medium text-destructive")}>
        {span.name}
      </span>
      {span.tokens && (
        <span className="shrink-0 font-mono text-[10px]">
          <span className="text-[var(--trace-llm)]">{fmtTok(span.tokens.input)}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-[var(--trace-tool)]">{fmtTok(span.tokens.output)}</span>
        </span>
      )}
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {formatDuration(displayDurationMs(span))}
      </span>
      {failed && <span className="text-xs text-destructive">✕</span>}
    </div>
  );
}

function fmtTok(n: number): string {
  if (n == null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

// ==================== 右侧 Span 详情 ====================

function SpanDetails({ span, totalSeconds }: { span: TraceSpan; totalSeconds: number }) {
  const color = spanColor(span);
  const failed = isFailed(span);
  const startPct = totalSeconds > 0 ? (span.relStart / totalSeconds) * 100 : 0;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: color }} />
        <h3 className="text-[15px] font-medium">{span.name}</h3>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <DetailCell label="类型" value={<span className="font-mono">{kindLabel(span.kind)}</span>} />
        <DetailCell
          label="状态"
          value={
            <span className={failed ? "text-destructive" : "text-[var(--trace-tool)]"}>
              {failed ? "错误" : "正常"}
            </span>
          }
        />
        <DetailCell label="开始" value={<span className="font-mono">{span.relStart.toFixed(2)}s</span>} />
        <DetailCell
          label="耗时"
          value={<span className="font-mono">{formatDuration(span.durationMs)}</span>}
        />
        {span.model && (
          <DetailCell label="模型" value={<span className="font-mono break-all">{span.model}</span>} />
        )}
        {span.roundIndex >= 0 && (
          <DetailCell label="轮次" value={<span className="font-mono">Round {span.roundIndex}</span>} />
        )}
      </div>

      {span.tokens && (
        <div className="mb-4">
          <div className="mb-1 flex items-center gap-3 font-mono text-sm">
            <span>
              <span className="text-[var(--trace-llm)]">{span.tokens.input}</span>{" "}
              <span className="text-xs text-muted-foreground">输入</span>
            </span>
            <span>
              <span className="text-[var(--trace-tool)]">{span.tokens.output}</span>{" "}
              <span className="text-xs text-muted-foreground">输出</span>
            </span>
            <span className="text-muted-foreground">合计 {formatTokens(span.tokens.total)}</span>
          </div>
          <div className="mt-1 flex gap-3 font-mono text-[11px] text-muted-foreground">
            <span>缓存读 {formatTokens(span.tokens.cacheRead)}</span>
            <span>缓存写 {formatTokens(span.tokens.cacheWrite)}</span>
          </div>
          {/* 时间轴位置指示 */}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(startPct, 100)}%`, background: color }}
            />
          </div>
        </div>
      )}

      <hr className="my-4 border-border" />

      <div className="space-y-3">
        {failed && span.error && (
          <div>
            <span className="text-xs text-destructive">错误信息</span>
            <pre className="mt-1 rounded bg-destructive/10 p-2.5 text-xs whitespace-pre-wrap text-destructive">
              {span.error}
            </pre>
          </div>
        )}
        {span.input && (
          <div>
            <span className="text-xs text-muted-foreground">
              {span.kind === "tool_call" ? "调用参数" : "输入"}
            </span>
            <Pre text={span.input} />
          </div>
        )}
        {span.output && (
          <div>
            <span className="text-xs text-muted-foreground">
              {span.kind === "tool_call" ? "执行结果" : "输出"}
            </span>
            <Pre text={span.output} />
          </div>
        )}
        {!span.input && !span.output && !failed && (
          <p className="text-xs text-muted-foreground">该 Span 无记录内容</p>
        )}
        <div className="font-mono text-[10px] text-muted-foreground/70">Span ID: {span.id}</div>
      </div>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function Pre({ text }: { text: string }) {
  const MAX = 4000;
  const shown = text.length > MAX ? text.slice(0, MAX) + `\n…（已截断，共 ${text.length} 字符）` : text;
  return (
    <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted/40 p-2.5 text-xs leading-relaxed whitespace-pre-wrap break-all">
      {shown}
    </pre>
  );
}
