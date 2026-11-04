"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, RotateCcw, Wrench, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatsRange } from "@/lib/engine/stats/range";

/**
 * 问题单追踪（PLAN M1.4）。
 *
 * 与上方「问题列表 / 运行异常分析」的分工：那两块是**即时检测**（每次进页面重算，
 * 无状态）；本面板是**持久化实体**——同一问题跨会话聚合（fingerprint）、可确认、
 * 可标记已修（带版本锚点）、复发自动重开。运维动作发生在这里。
 */

interface IssueItem {
  id: string;
  agentName: string;
  type: string;
  severity: string;
  fingerprint: string;
  title: string;
  evidence: { sessionId: string; summary: string; outcome: string; attempts: number; startedAt: string }[];
  sessionId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  status: string;
  fixedInVersion: string;
}

const SEVERITY_META: Record<string, { label: string; badge: string }> = {
  critical: { label: "严重", badge: "bg-destructive/10 text-destructive" },
  warning: { label: "关注", badge: "bg-warning/10 text-warning" },
  info: { label: "提示", badge: "bg-info/10 text-info" },
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  open: { label: "待处理", badge: "bg-destructive/10 text-destructive" },
  ack: { label: "已确认", badge: "bg-warning/10 text-warning" },
  fixed: { label: "已修复", badge: "bg-success/10 text-success" },
  wontfix: { label: "不修", badge: "bg-muted text-muted-foreground" },
  stale: { label: "超窗", badge: "bg-muted text-muted-foreground" },
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function IssueTrackerPanel({ agentName, range }: { agentName: string; range: StatsRange }) {
  const [issues, setIssues] = useState<IssueItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [versionInput, setVersionInput] = useState<{ id: string; value: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/issues?agentName=${encodeURIComponent(agentName)}`)
      .then((r) => r.json() as Promise<IssueItem[]>)
      .then((d) => setIssues(d))
      .catch(() => setIssues([]))
      .finally(() => setLoading(false));
  }, [agentName]);

  useEffect(() => {
    load();
  }, [load]);

  async function recompute() {
    setBusy(true);
    setMessage(null);
    try {
      // 与 resolveRange 的窗口定义一致（realtime=今日按 1 天算、weekly=7 天）
      const rangeDays = range === "all" ? 0 : range === "realtime" ? 1 : range === "weekly" ? 7 : range === "3d" ? 3 : 30;
      const r = await fetch("/api/issues/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, rangeDays }),
      });
      const body = (await r.json()) as {
        error?: string;
        detected?: number;
        created?: number;
        updated?: number;
        reopened?: number;
        staled?: number;
      };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setMessage(
        `检测 ${body.detected ?? 0} 条 · 新建 ${body.created ?? 0} · 更新 ${body.updated ?? 0}` +
          (body.reopened ? ` · 复发重开 ${body.reopened}` : "") +
          (body.staled ? ` · 超窗 ${body.staled}` : ""),
      );
      load();
    } catch (e: unknown) {
      setMessage(`重算失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, status: string, fixedInVersion?: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/issues/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(fixedInVersion !== undefined ? { fixedInVersion } : {}) }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setVersionInput(null);
      load();
    } catch (e: unknown) {
      setMessage(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !issues) {
    return <p className="flex h-16 items-center justify-center text-sm text-muted-foreground">加载中...</p>;
  }

  const openCount = (issues ?? []).filter((i) => i.status === "open" || i.status === "ack").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={recompute}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm border border-border/70 px-2.5 py-1 text-xs font-medium",
            "hover:bg-muted disabled:opacity-50",
          )}
        >
          <RotateCcw className="size-3.5" />
          {busy ? "处理中..." : `从检测器重算（${range}）`}
        </button>
        <span className="text-[11px] text-muted-foreground/80">
          {openCount > 0 ? `${openCount} 个待处理问题` : "无待处理问题"}
          {" · "}同一失败家族跨会话聚合，标记已修需填版本号
        </span>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      {(issues ?? []).length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          还没有落库的问题单——点上方按钮，把当前窗口的检测结果固化为可追踪的问题。
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {(issues ?? []).map((issue) => {
            const sev = SEVERITY_META[issue.severity] ?? SEVERITY_META.warning;
            const st = STATUS_META[issue.status] ?? STATUS_META.open;
            const evidence = issue.evidence ?? [];
            return (
              <li key={issue.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-sm px-1.5 py-0.5 text-[11px] font-medium", sev.badge)}>
                    {sev.label}
                  </span>
                  <span className={cn("rounded-sm px-1.5 py-0.5 text-[11px] font-medium", st.badge)}>
                    {st.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm" title={issue.title}>
                    {issue.title}
                  </span>
                  <span className="text-[11px] text-muted-foreground/80">
                    ×{issue.occurrences} · 最近 {fmt(issue.lastSeenAt)}
                    {issue.status === "fixed" && issue.fixedInVersion ? ` · 修于 ${issue.fixedInVersion}` : ""}
                  </span>
                </div>

                {evidence.length > 0 && (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground/80" title={evidence.map((e) => e.summary).join(" | ")}>
                    证据 {evidence.length} 条 · {evidence[0].summary}
                    {issue.sessionId && (
                      <>
                        {" · "}
                        <Link
                          href={`/trace/${issue.sessionId}`}
                          className="underline decoration-border underline-offset-2 hover:text-foreground"
                        >
                          链路
                        </Link>
                      </>
                    )}
                  </p>
                )}

                {(issue.status === "open" || issue.status === "ack") && (
                  <div className="mt-1.5 flex items-center gap-2">
                    {versionInput?.id === issue.id ? (
                      <>
                        <input
                          autoFocus
                          value={versionInput.value}
                          onChange={(e) => setVersionInput({ id: issue.id, value: e.target.value })}
                          placeholder="修复版本号，如 1.2.0"
                          className="h-6 w-40 rounded-sm border border-border bg-transparent px-2 text-xs"
                        />
                        <button
                          type="button"
                          disabled={busy || !versionInput.value.trim()}
                          onClick={() => patch(issue.id, "fixed", versionInput.value.trim())}
                          className="inline-flex items-center gap-1 rounded-sm bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success disabled:opacity-50"
                        >
                          <Wrench className="size-3" /> 确认已修
                        </button>
                        <button
                          type="button"
                          onClick={() => setVersionInput(null)}
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3" /> 取消
                        </button>
                      </>
                    ) : (
                      <>
                        {issue.status === "open" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => patch(issue.id, "ack")}
                            className="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            <Check className="size-3" /> 确认
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setVersionInput({ id: issue.id, value: "" })}
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          <Wrench className="size-3" /> 标记已修
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => patch(issue.id, "wontfix")}
                          className="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          <X className="size-3" /> 不修
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
