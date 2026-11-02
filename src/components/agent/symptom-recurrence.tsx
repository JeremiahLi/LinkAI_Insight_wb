"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecurrenceReport, RecurrenceRow } from "@/lib/engine/detect/recurrence";

/**
 * 症状复发（纵向视角）。
 *
 * 与上面两块的分工：
 * - 问题列表：现在有什么问题、根因是什么（横向快照）
 * - 本区块：同一个问题是不是**反复出现**、上个月到现在有没有真的消停（纵向追踪）
 * - 运行异常分析：每一次失败的具体链路
 *
 * 一个必须写在界面上的口径：**「本周没出现」不等于修好了**，可能只是没走到那条路径。
 * 所以每行都带分母（该家族涉及接口的调用次数），让用户自己判断是「真不犯了」还是「没做那个操作」。
 */

const WEEK_OPTIONS = [4, 8, 12, 26] as const;
const VISIBLE_ROWS = 6;

interface RecurrenceResponse extends RecurrenceReport {
  agentName: string;
  sessionCount: number;
  spanCount: number;
}

function fmtWeek(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SymptomRecurrence({ agentName }: { agentName: string }) {
  const [weeks, setWeeks] = useState<number>(8);
  const [data, setData] = useState<RecurrenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agents/${encodeURIComponent(agentName)}/recurrence?weeks=${weeks}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<RecurrenceResponse>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentName, weeks, nonce]);

  const rows = data?.rows ?? [];
  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS);

  // 迷你柱状图的公共刻度：所有行共用一个 max，行与行之间才可比
  const maxCount = useMemo(() => Math.max(1, ...rows.flatMap((r) => r.buckets.map((b) => b.count))), [rows]);

  return (
    <div className={cn("transition-opacity", loading && data && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1">
          {WEEK_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeks(w)}
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[11px] transition-colors",
                weeks === w
                  ? "bg-foreground/[0.08] font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {w} 周
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setNonce((v) => v + 1)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          刷新
        </button>
        {data && (
          <span className="text-[11px] text-muted-foreground">
            <span className="font-mono tabular-nums text-foreground">{data.families}</span> 个失败家族 · 复发{" "}
            <span className={cn("font-mono tabular-nums", data.recurredFamilies > 0 ? "text-warning" : "text-foreground")}>
              {data.recurredFamilies}
            </span>{" "}
            · 失败样本 <span className="font-mono tabular-nums text-foreground">{data.totalFailures}</span> /{" "}
            {data.sessionCount} 个会话
          </span>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">统计失败：{error}</p>}

      {!error && data && rows.length === 0 && (
        <p className="mt-3 flex h-20 items-center justify-center text-sm text-muted-foreground">
          近 {weeks} 周没有工具失败
        </p>
      )}

      {!error && rows.length > 0 && (
        <>
          <ul className="mt-2.5 space-y-1.5">
            {visible.map((row) => (
              <RecurrenceRowView key={row.family} row={row} maxCount={maxCount} />
            ))}
          </ul>
          {rows.length > VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-1.5 text-[10.5px] text-primary hover:underline"
            >
              {showAll ? "收起" : `还有 ${rows.length - VISIBLE_ROWS} 个家族，展开`}
            </button>
          )}
          <p className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-relaxed text-muted-foreground">
            触发率 = 出现次数 ÷ 该家族涉及接口的调用次数（不是会话数）。「本周期没出现」不等于已修复 ——
            也可能只是没走到那条路径，请同时看分母。复发 = 至少两周出现过。
          </p>
        </>
      )}
    </div>
  );
}

function RecurrenceRowView({ row, maxCount }: { row: RecurrenceRow; maxCount: number }) {
  return (
    <li className="rounded-lg bg-muted/30 px-3 py-2 ring-1 ring-foreground/[0.04]">
      <div className="flex flex-wrap items-center gap-1.5">
        {row.recurred ? (
          <span className="rounded-sm bg-warning/10 px-1 py-px text-[10px] font-medium text-warning">复发</span>
        ) : (
          <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">单次</span>
        )}
        <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">{row.kindLabel}</span>
        <span className="text-[12px] font-medium">
          <span className="font-mono tabular-nums">{row.total}</span> 次 · {row.sessionCount} 会话 · 跨 {row.activeWeeks} 周
        </span>
        <span
          className={cn(
            "rounded-sm px-1 py-px font-mono text-[10px] tabular-nums",
            row.rate >= 20
              ? "bg-destructive/10 text-destructive"
              : row.rate >= 10
                ? "bg-warning/10 text-warning"
                : "bg-muted text-muted-foreground",
          )}
          title="触发率 = 出现次数 ÷ 涉及接口调用次数"
        >
          {row.rate.toFixed(1)}%
        </span>
        <span className="text-[10px] text-muted-foreground">{row.tools.join(" / ")}</span>
      </div>

      <div className="mt-1.5 flex items-start gap-2.5">
        {/* 迷你周柱：所有行共用同一 maxCount 刻度，行与行之间才可比；0 值也占位保证时间轴连续 */}
        <div className="shrink-0">
          <div className="flex h-6 items-end gap-[3px] border-b border-border/50 pb-px">
            {row.buckets.map((b) => (
              <span
                key={b.weekStartMs}
                title={`${fmtWeek(b.weekStartMs)} 周：${b.count} 次失败 / ${b.calls} 次调用`}
                className={cn("w-[7px] rounded-sm", b.count === 0 ? "bg-muted-foreground/15" : "bg-warning/70")}
                style={{ height: b.count === 0 ? 3 : Math.max(4, Math.round((b.count / maxCount) * 24)) }}
              />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between text-[9px] tabular-nums text-muted-foreground/60">
            <span>{fmtWeek(row.buckets[0]?.weekStartMs ?? 0)}</span>
            <span>{fmtWeek(row.buckets[row.buckets.length - 1]?.weekStartMs ?? 0)}</span>
          </div>
        </div>
        <p className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-muted-foreground" title={row.summary}>
          {row.summary || "（无摘要）"}
        </p>
        <Link
          href={`/trace/${row.sampleSessionId}?spanId=${encodeURIComponent(row.sampleSpanId)}`}
          className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] text-primary hover:underline"
        >
          最近一次
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>
    </li>
  );
}
