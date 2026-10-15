"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpanTreeView } from "@/components/trace/span-tree-view";
import { SpanDetailPanel } from "@/components/trace/span-detail-panel";
import { SessionOverview } from "@/components/trace/session-overview";
import { SessionFlowGraph } from "@/components/flow/session-flow-graph";
import { formatTokens, formatDuration, formatDateTime } from "@/lib/format";
import type { SessionDetail, SpanNode, RoundNode } from "@/components/trace/types";

type ViewMode = "tree" | "flow";

export default function TraceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<ViewMode>("tree");
  const [selectedSpan, setSelectedSpan] = useState<{ span: SpanNode; round: RoundNode } | null>(null);

  const sessionId = params.traceId as string;

  const loadDetail = () => {
    setLoading(true);
    setNotFound(false);
    fetch(`/api/sessions/${sessionId}`)
      .then((res) => {
        if (res.status === 404) { setNotFound(true); return null; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data) {
          setDetail(data);
          setSelectedSpan(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => { loadDetail(); }, [sessionId]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-56px)] items-center justify-center">
        <p className="text-sm text-muted-foreground">加载中...</p>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Session 未找到: {sessionId}</p>
        <Button variant="outline" size="sm" onClick={() => router.push("/trace")}>
          返回列表
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col gap-3 p-6">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => router.push("/trace")}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <h1 className="shrink-0 text-xl font-semibold tracking-tight">{detail.agentName}</h1>
          <div className="flex items-center gap-4 truncate text-[13px] text-muted-foreground">
            <span>用户 <span className="font-medium text-foreground">{detail.userName}</span></span>
            <span className="tabular-nums">轮次 <span className="font-medium text-foreground">{detail.totalRounds}</span></span>
            <span className="tabular-nums">Span <span className="font-medium text-foreground">{detail.totalSpans}</span></span>
            <span className="tabular-nums">Token <span className="font-medium text-foreground">{formatTokens(detail.totalTokens)}</span></span>
            <span className="tabular-nums">耗时 <span className="font-medium text-foreground">{formatDuration(detail.totalDuration)}</span></span>
            <span className="tabular-nums">{formatDateTime(new Date(detail.startTime).getTime())}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            <Button
              variant={view === "tree" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setView("tree")}
            >
              树形视图
            </Button>
            <Button
              variant={view === "flow" ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2.5 text-xs"
              onClick={() => setView("flow")}
            >
              流程图
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={loadDetail}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
        </div>
      </div>

      {/* Body: 按视图切换 */}
      {view === "flow" ? (
        <div className="flex flex-1 min-h-0 overflow-hidden rounded-lg border border-border bg-card">
          <SessionFlowGraph detail={detail} />
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="w-2/5 overflow-hidden border-r border-border">
            <SpanTreeView
              session={{ id: detail.id, totalRounds: detail.totalRounds, totalSpans: detail.totalSpans, rounds: detail.rounds }}
              selectedSpanId={selectedSpan?.span.id ?? null}
              onSelectSpan={(span, round) => setSelectedSpan({ span, round })}
              onSelectSession={() => setSelectedSpan(null)}
              onSelectRound={(round) => {
                if (round.inputSpan) {
                  setSelectedSpan({ span: round.inputSpan, round });
                } else if (round.systemPromptSpan) {
                  setSelectedSpan({ span: round.systemPromptSpan, round });
                }
              }}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            {selectedSpan ? (
              <SpanDetailPanel span={selectedSpan.span} round={selectedSpan.round} allRounds={detail.rounds} />
            ) : (
              <SessionOverview session={detail} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
