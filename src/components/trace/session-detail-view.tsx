"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ArrowLeft, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TraceTimeline } from "./trace-timeline";
import { TraceTranscript } from "./trace-transcript";
import { OutcomeBadge } from "./shared";
import {
  buildCalls,
  compressIdleGaps,
  cumulativeParts,
  displayDurationMs,
  flattenSession,
  isFailed,
  isToolKind,
  kindLabel,
  spanColor,
  totalSecondsOf,
  type CallInfo,
  type TraceSpan,
} from "./trace-helpers";
import { formatDuration, formatTokens } from "@/lib/format";
import type { SessionDetail, SpanNode, RoundNode } from "./types";

/**
 * Session 详情（全幅）。
 *
 * 从原来的右侧浮窗（TraceViewerPanel）搬过来的三栏视图：
 *   左 Span 层级树 / 中 Timeline（甘特 + Token 图）或 Transcript / 右 Span 详情。
 * 改成路由页之后去掉遮罩、拖拽宽度和全屏按钮，补上 404 / 加载失败分支
 * （浮窗里 fetch 失败只是不显示，整页失败会白屏）。
 *
 * 支持 ?spanId=xxx 直达：从「失败样例」这类深链进来时自动选中并滚动到该 span。
 */
interface Props {
  sessionId: string;
  onBack?: () => void;
}

export function SessionDetailView({ sessionId, onBack }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  // 选中的 Token 调用柱（view: "cum" = 累计构成 / "delta" = 本次新增构成）
  const [selectedCall, setSelectedCall] = useState<{ id: string; view: "cum" | "delta" } | null>(
    null,
  );
  const [view, setView] = useState<"timeline" | "transcript">("timeline");
  const [reloadToken, setReloadToken] = useState(0);
  /** 深链要定位的 span：与 selectedSpanId 分开，避免用户点树时甘特反复重新聚焦 */
  const [focusSpanId, setFocusSpanId] = useState<string | null>(null);
  // ?spanId= 只应用一次：之后用户手动点的选中项不能被刷新/重算覆盖
  const appliedLinkRef = useRef(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (res.status === 404) {
        setNotFound(true);
        setDetail(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionDetail = await res.json();
      if (!data || !Array.isArray(data.rounds)) throw new Error("响应结构异常");
      setDetail(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // 换会话时彻底重置视图状态
  useEffect(() => {
    setSelectedSpanId(null);
    setSelectedCall(null);
    setFocusSpanId(null);
    setView("timeline");
    appliedLinkRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail, reloadToken]);

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
  const calls = useMemo(() => buildCalls(spans), [spans]);
  const selectedCallInfo = useMemo(
    () => (selectedCall ? (calls.find((c) => c.id === selectedCall.id) ?? null) : null),
    [calls, selectedCall],
  );
  // 跨区域同步标记：点击柱体 → 树/甘特高亮对应 LLM；点击树/甘特中的 LLM → 两图柱体高亮
  const highlightCallId = useMemo(() => {
    if (selectedCall) return selectedCall.id;
    const sp = selectedSpan;
    if (sp && sp.kind === "llm_thinking" && calls.some((c) => c.id === sp.id)) return sp.id;
    return null;
  }, [selectedCall, selectedSpan, calls]);

  const llmCount = useMemo(() => spans.filter((s) => s.kind === "llm_thinking").length, [spans]);
  const toolCount = useMemo(
    () => spans.filter((s) => s.kind === "tool_call" || s.kind === "command").length,
    [spans],
  );
  const failedToolCount = useMemo(
    () => spans.filter((s) => (s.kind === "tool_call" || s.kind === "command") && isFailed(s)).length,
    [spans],
  );

  // ?spanId= 只应用一次：之后用户手动点的选中项不能被刷新/重算覆盖
  useEffect(() => {
    if (appliedLinkRef.current || spans.length === 0) return;
    appliedLinkRef.current = true;
    const spanId = new URLSearchParams(window.location.search).get("spanId");
    if (!spanId) return;
    // 不在拍平结果里（例如带 branchId 但该 Round 没有 fork 点的 span）就静默退回会话顶部
    if (!spans.some((s) => s.id === spanId)) return;

    setSelectedSpanId(spanId);
    setFocusSpanId(spanId);
    setSelectedCall(null);
    // 参数用完即清，避免刷新后总被拽回这一条
    const url = new URL(window.location.href);
    url.searchParams.delete("spanId");
    window.history.replaceState(null, "", url.pathname + url.search);

    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-span-id="${CSS.escape(spanId)}"]`);
      el?.scrollIntoView({ block: "center" });
    });
  }, [spans]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (notFound || errorMsg || !detail) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          {notFound ? `Session 未找到：${sessionId}` : `加载失败：${errorMsg ?? "未知错误"}`}
        </p>
        <div className="flex items-center gap-2">
          {!notFound && (
            <Button variant="outline" size="sm" onClick={() => setReloadToken((v) => v + 1)}>
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </Button>
          )}
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>
              返回列表
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col overflow-hidden">
      {/* Header：统计条（窄屏换行，不再固定单行） */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-1.5 border-b border-border bg-card px-5 py-2">
        {/* min-w-0 + flex-1：标题过长时截断，而不是把右侧整组挤到第二行 */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={onBack}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回
            </Button>
          )}
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-base shrink-0">{detail.agentEmoji}</span>
            {/* 标题优先：没有标题时退回 Agent 名，避免出现空 h1 */}
            <h1 className="truncate text-base font-semibold tracking-tight">
              {detail.title || detail.agentName}
            </h1>
            <span className="truncate text-sm text-muted-foreground" title={detail.id}>
              · {detail.agentName} · {detail.projectName} · {detail.userName} · #{detail.id.slice(0, 8)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
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
            {/* 终态与「过程失败」分开看：过程有失败不代表会话失败 */}
            <OutcomeBadge outcome={detail.outcome ?? ""} status={detail.status} />
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="刷新"
            onClick={() => setReloadToken((v) => v + 1)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 主体：三栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左：Span 层级树 */}
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-card xl:w-72">
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
              onSelect={(id) => {
                setSelectedSpanId(id);
                // 右栏回到 Span 详情；若选中的是 LLM 调用，两图对应柱体仍保持高亮
                setSelectedCall(null);
              }}
              onSelectCall={(id, v) => {
                // 点击柱体：右栏显示构成明细，同时同步高亮左树/甘特中对应的 LLM 条
                setSelectedCall({ id, view: v });
                setSelectedSpanId(id);
              }}
              highlightCallId={highlightCallId}
              revealSpanId={focusSpanId}
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
        <aside className="w-[340px] shrink-0 overflow-y-auto scrollbar-thin border-l border-border bg-card xl:w-96">
          <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {selectedCall ? "Token 构成明细" : "Span 详情"}
            </h2>
          </div>
          <div className="p-4 text-sm">
            {selectedCall && selectedCallInfo ? (
              <CallBreakdownPanel
                call={selectedCallInfo}
                view={selectedCall.view}
                calls={calls}
                onBack={() => setSelectedCall(null)}
              />
            ) : selectedSpan ? (
              <SpanDetails span={selectedSpan} totalSeconds={totalSeconds} />
            ) : (
              <p className="text-muted-foreground">
                点击左侧树或 Timeline 中的条查看详情；点击下方图表柱体可查看 Token 构成
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
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
        status === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-[var(--trace-tool)]/40 bg-[var(--trace-tool)]/10 text-[var(--trace-tool)]",
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
        <span>{round.index + 1}</span>
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
          {/* Tool 行缩进一级，归属到其所属的 LLM 思考 */}
          {roundSpans.map((span) => (
            <TreeItem
              key={span.id}
              span={span}
              depth={isToolKind(span.kind) ? 1 : 0}
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
      data-span-id={span.id}
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
          <DetailCell label="轮次" value={<span className="font-mono">Round {span.roundIndex + 1}</span>} />
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
        {/* 采集端附加字段：老详情页的 SpanDetailPanel 有，浮窗里缺，这里补回来 */}
        {span.content && (
          <div>
            <span className="text-xs text-muted-foreground">内容</span>
            <Pre text={span.content} />
          </div>
        )}
        {span.details && (
          <div>
            <span className="text-xs text-muted-foreground">附加明细</span>
            <Pre text={span.details} />
          </div>
        )}
        {!span.input && !span.output && !span.content && !span.details && !failed && (
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

// ==================== Token 调用构成明细（点击图表柱体后展示） ====================

function CallBreakdownPanel({
  call,
  view,
  calls,
  onBack,
}: {
  call: CallInfo;
  view: "cum" | "delta";
  calls: CallInfo[];
  onBack: () => void;
}) {
  // delta 视图 = 该次调用的新增构成；cum 视图 = 截至该次调用的累计构成
  const { parts, total } = useMemo(() => {
    if (view === "delta") {
      return { parts: call.parts, total: call.total };
    }
    const agg = cumulativeParts(calls, call.order);
    return { parts: agg.parts, total: agg.total };
  }, [view, call, calls]);

  return (
    <div>
      {/* 头部：返回 + 调用标识 */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="返回 Span 详情"
        >
          ← 返回
        </button>
        <h3 className="text-[15px] font-medium">
          {view === "delta" ? `第 ${call.order} 次 LLM 调用 · 本次新增` : `前 ${call.order} 次调用 · 累计构成`}
        </h3>
      </div>

      {/* 调用基本信息 */}
      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <DetailCell
          label="时间"
          value={<span className="font-mono">{call.time.toFixed(2)}s</span>}
        />
        <DetailCell
          label="耗时"
          value={<span className="font-mono">{call.duration.toFixed(2)}s</span>}
        />
        <DetailCell label="轮次" value={<span className="font-mono">Round {call.roundIndex + 1}</span>} />
        {call.model && (
          <DetailCell label="模型" value={<span className="font-mono break-all">{call.model}</span>} />
        )}
      </div>

      {/* 构成占比列表 */}
      <div className="space-y-2.5">
        {parts.length === 0 && (
          <p className="text-xs text-muted-foreground">该调用无 Token 构成数据</p>
        )}
        {parts.map((p) => {
          const pct = total > 0 ? (p.value / total) * 100 : 0;
          return (
            <div key={p.key} title={p.desc}>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: `var(${p.colorVar})` }}
                />
                <span className="flex-1 truncate">{p.label}</span>
                <span className="font-mono font-medium">{formatTokens(p.value)}</span>
                <span className="w-12 shrink-0 text-right font-mono text-muted-foreground">
                  {pct.toFixed(1)}%
                </span>
              </div>
              {/* 占比条 */}
              <div className="mt-1 ml-[18px] h-1.5 overflow-hidden rounded-full bg-muted/60">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(pct, 100)}%`, background: `var(${p.colorVar})` }}
                />
              </div>
              {p.desc && (
                <p className="ml-[18px] mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                  {p.desc}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* 合计 + 说明 */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted-foreground">
          {view === "delta" ? "本次新增合计" : "累计合计"}
        </span>
        <span className="font-mono text-sm font-semibold">{formatTokens(total)}</span>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground/70">
        说明：total = input + output + 缓存读 + 缓存写。缓存读 = 命中提示缓存的输入
        （与之前重复的前缀直接复用、无需重新计算），缓存写 = 新写入缓存的输入；
        两者为 API 上报的真实值，多轮会话中缓存读通常是最大成分。
        assistant / tool 结果 / 用户输入 / 系统提示为按字符数估算（≈4 字符/token），
        各估算子项超出合计时按比例缩减。
      </p>
    </div>
  );
}
