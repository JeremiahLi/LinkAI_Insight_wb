"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ThumbsUp, ThumbsDown, RotateCcw, Bot } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * 告警中心（PLAN M4）：修复原 /alerts 死链。
 * 两块内容：指标劣化问题单（M4.1，24h vs 前 7 天）+ 用户信号（M4.3/4.4）。
 * 扫描为手动/外部定时触发（POST /api/alerts），不内置常驻定时器。
 */

interface RegressionIssue {
  id: string;
  agentName: string;
  severity: string;
  status: string;
  title: string;
  evidence: { baseline: number; recent: number; delta: string; recentSamples: number; baselineSamples: number }[];
  occurrences: number;
  lastSeenAt: string;
}

interface FeedbackRow {
  id: string;
  sessionId: string;
  kind: string;
  note: string;
  by: string;
  createdAt: string;
  sessionTitle: string | null;
  agentName: string;
}

interface AlertData {
  regressions: RegressionIssue[];
  feedbackByKind: Record<string, number>;
  feedbackTotal: number;
  recentFeedback: FeedbackRow[];
}

const SEVERITY_BADGE: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
};

const STATUS_LABEL: Record<string, string> = {
  open: "劣化中",
  ack: "已确认",
  fixed: "已恢复",
  stale: "已恢复",
  wontfix: "忽略",
};

const KIND_META: Record<string, { label: string; icon: typeof ThumbsUp; color: string }> = {
  thumbs_up: { label: "有用", icon: ThumbsUp, color: "text-success" },
  thumbs_down: { label: "无用", icon: ThumbsDown, color: "text-destructive" },
  reask: { label: "重新提问", icon: RotateCcw, color: "text-warning" },
  abandon: { label: "放弃", icon: Bot, color: "text-muted-foreground" },
  adopt: { label: "采纳", icon: ThumbsUp, color: "text-info" },
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function AlertsPage() {
  const [data, setData] = useState<AlertData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/alerts")
      .then((r) => r.json() as Promise<AlertData>)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function scan() {
    setScanning(true);
    setScanMessage(null);
    try {
      const r = await fetch("/api/alerts", { method: "POST" });
      const body = (await r.json()) as {
        error?: string;
        checkedAgents?: number;
        findings?: unknown[];
        created?: number;
        updated?: number;
        notified?: boolean;
        notifyDetail?: string;
        notes?: string[];
      };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setScanMessage(
        `扫描 ${body.checkedAgents ?? 0} 个 Agent · 劣化 ${body.findings?.length ?? 0} 项` +
          `（新建 ${body.created ?? 0} / 更新 ${body.updated ?? 0}）· ${body.notifyDetail ?? ""}`,
      );
      load();
    } catch (e: unknown) {
      setScanMessage(`扫描失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="shrink-0 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">告警中心</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            指标劣化（24h vs 前 7 天）· 用户信号 · 推送走企业微信机器人 webhook
          </p>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm border border-border/70 px-2.5 py-1 text-xs font-medium",
            "hover:bg-muted disabled:opacity-50",
          )}
        >
          <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} />
          {scanning ? "扫描中..." : "立即扫描"}
        </button>
      </div>

      {scanMessage && <p className="text-xs text-muted-foreground">{scanMessage}</p>}

      {/* 指标劣化 */}
      <Card>
        <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>指标劣化</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            成功率跌 ≥5pp（严重）· token / P95 涨 ≥30%（关注）· 恢复自动转「已恢复」
          </span>
        </CardHeader>
        <CardContent className="pt-3">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>
          ) : !data || data.regressions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              当前无劣化告警——点「立即扫描」可手动触发一次对比
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.regressions.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className={cn("rounded-sm px-1.5 py-0.5 text-[11px] font-medium", SEVERITY_BADGE[r.severity])}>
                    {r.severity === "critical" ? "严重" : "关注"}
                  </span>
                  <span className={cn("rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground")}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm" title={r.title}>
                    <Link
                      href={`/agent-board/${encodeURIComponent(r.agentName)}`}
                      className="hover:underline"
                    >
                      {r.agentName}
                    </Link>
                    {" · "}
                    {r.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground/80 tabular-nums">
                    ×{r.occurrences} · 最近 {fmt(r.lastSeenAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 用户信号 */}
      <Card>
        <CardHeader className="flex-row items-baseline justify-between space-y-0 border-b border-border/60 pb-2.5">
          <CardTitle>用户信号</CardTitle>
          <span className="text-[11px] text-muted-foreground/80">
            trace 详情页标注「有用/无用/重新提问」· 放弃检测自动落库（by=auto）
          </span>
        </CardHeader>
        <CardContent className="pt-3">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                {Object.entries(KIND_META).map(([kind, meta]) => {
                  const n = data?.feedbackByKind[kind] ?? 0;
                  return (
                    <span key={kind} className={cn("inline-flex items-center gap-1.5 text-[13px]", n > 0 ? meta.color : "text-muted-foreground/60")}>
                      <meta.icon className="size-3.5" />
                      {meta.label}
                      <span className="tabular-nums font-medium">{n}</span>
                    </span>
                  );
                })}
                <span className="text-[11px] text-muted-foreground/80">共 {data?.feedbackTotal ?? 0} 条</span>
              </div>
              {!data || data.recentFeedback.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  还没有用户信号——在 trace 详情页右上角标注即可
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {data.recentFeedback.map((f) => {
                    const meta = KIND_META[f.kind] ?? KIND_META.adopt;
                    return (
                      <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                        <meta.icon className={cn("size-3.5", meta.color)} />
                        <span className="text-[13px]">{meta.label}</span>
                        <span className="text-[11px] text-muted-foreground/80">
                          {f.agentName} · {f.by === "auto" ? "自动检测" : f.by} · {fmt(f.createdAt)}
                        </span>
                        <Link
                          href={`/trace/${f.sessionId}`}
                          className="min-w-0 flex-1 truncate text-right text-[12px] text-muted-foreground hover:text-foreground hover:underline"
                          title={f.sessionTitle || f.sessionId}
                        >
                          {f.sessionTitle || f.sessionId.slice(-8)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
