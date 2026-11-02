"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import type { StatsRange } from "@/lib/engine/stats/range";
import type { AgentFailureReport, FailureChainDTO, FailureFamilyDTO } from "@/lib/engine/detect/agent-failures";
import type { CommandSample, CommandStat } from "@/lib/engine/detect/command-stats";

/**
 * 运行异常分析（过程链路级）。
 *
 * 与页面上方「问题列表」的分工：
 * - 问题列表：统计聚合（工具失败率、错误聚类、慢 span），回答「哪个工具在失败、失败率多高」
 * - 本面板：失败链（失败 → 重试 → 结局），回答「这一次怎么失败、自愈没有、根因是什么、怎么修」
 *
 * 默认只展开第一类，避免一屏全是红色把真正严重的淹掉（同上方面板的取舍）。
 */

const KIND_LABEL: Record<string, string> = {
  exit_code: "非零退出",
  exception: "运行异常",
  missing_path: "路径不存在",
  permission: "权限/占用",
  encoding: "编码不一致",
  shell_syntax: "命令语法错误",
  edit_mismatch: "编辑定位失败",
  json_invalid: "JSON 不合法",
  invalid_argument: "入参越界",
  command_not_found: "命令缺失",
  timeout: "超时",
  io_error: "文件类型错误",
  interrupted: "用户中止",
  not_an_error: "日志误写",
  unknown: "未归类",
};

const OUTCOME_LABEL: Record<string, string> = {
  retried_recovered: "重试自愈",
  retried_failed: "连续失败",
  abandoned: "未修复即交付",
  fatal: "致命失败",
  isolated: "孤立失败",
};

const SEVERITY_META: Record<string, { label: string; bar: string; badge: string }> = {
  critical: { label: "严重", bar: "bg-destructive", badge: "bg-destructive/10 text-destructive" },
  warning: { label: "关注", bar: "bg-warning", badge: "bg-warning/10 text-warning" },
  info: { label: "提示", bar: "bg-info", badge: "bg-info/10 text-info" },
};

const CONFIDENCE_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function FailureAnalysisPanel({ agentName, range }: { agentName: string; range: StatsRange }) {
  const [data, setData] = useState<AgentFailureReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFamily, setOpenFamily] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/agents/${encodeURIComponent(agentName)}/issues?range=${range}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<AgentFailureReport>;
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
  }, [agentName, range]);

  // 默认展开第一类：用户打开页面最想看的是最严重的那类，而不是先点一次
  const families = data?.families ?? [];
  const activeFamily = openFamily ?? families[0]?.family ?? null;

  const chainsByFamily = useMemo(() => {
    const m = new Map<string, FailureChainDTO[]>();
    for (const c of data?.chains ?? []) {
      const arr = m.get(c.family);
      if (arr) arr.push(c);
      else m.set(c.family, [c]);
    }
    return m;
  }, [data]);

  if (loading && !data) {
    return <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">分析中...</p>;
  }
  if (error) {
    return <p className="flex h-24 items-center justify-center text-sm text-destructive">分析失败：{error}</p>;
  }
  if (!data) return null;

  if (data.sessions === 0) {
    return (
      <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">该时间段内没有会话</p>
    );
  }

  return (
    <div className={cn("transition-opacity", loading && "opacity-60")}>
      {/* 概览 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]">
        <Stat label="异常链" value={data.totals.chains} />
        <Stat label="待处理" value={data.totals.actionable} tone={data.totals.actionable > 0 ? "warning" : "success"} />
        <Stat label="重试自愈" value={data.totals.selfHealed} tone="muted" />
        <span className="text-muted-foreground">
          涉及 {data.sessionsWithFailures} / {data.sessions} 个会话
        </span>
      </div>

      {families.length === 0 ? (
        <div className="mt-3 flex h-24 flex-col items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-success" />
          该时间段未发现需要处理的运行异常
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {families.map((f) => (
            <FamilyRow
              key={f.family}
              family={f}
              chains={chainsByFamily.get(f.family) ?? []}
              open={activeFamily === f.family}
              onToggle={() => setOpenFamily(activeFamily === f.family ? "" : f.family)}
            />
          ))}
        </ul>
      )}

      {data.commands.length > 0 && <CommandSection commands={data.commands} />}

      {data.dataNotes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border/40 pt-2">
          {data.dataNotes.map((n, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="min-w-0 break-words">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "success" | "muted" }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-[13px] tabular-nums",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function FamilyRow({
  family,
  chains,
  open,
  onToggle,
}: {
  family: FailureFamilyDTO;
  chains: FailureChainDTO[];
  open: boolean;
  onToggle: () => void;
}) {
  const meta = SEVERITY_META[family.severity] ?? SEVERITY_META.warning;
  return (
    <li className="relative rounded-lg bg-muted/30 ring-1 ring-foreground/[0.04]">
      <span className={cn("absolute bottom-2 left-0 top-2 w-[3px] rounded-full", meta.bar)} />
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 py-2.5 pl-3 pr-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-sm px-1 py-px text-[10px] font-medium", meta.badge)}>{meta.label}</span>
            <span className="rounded-sm bg-muted px-1 py-px text-[10px] text-muted-foreground">
              {KIND_LABEL[family.kind] ?? family.kind}
            </span>
            <span className="text-[13px] font-medium leading-snug">
              {family.count} 条 · {family.sessions} 个会话
            </span>
            {family.garbled && (
              <span className="rounded-sm bg-warning/10 px-1 py-px text-[10px] text-warning">原文乱码</span>
            )}
          </div>
          <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
            {family.sampleSummary || "（无摘要）"}
          </p>
        </div>
        <ChevronDown
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2">
          <div className="rounded-md bg-background/60 p-2 ring-1 ring-foreground/[0.03]">
            <p className="text-[11px] font-medium leading-relaxed">
              根因：{family.rootCause}
              <span className="ml-1 font-normal text-muted-foreground">
                （规则判定，置信度 {CONFIDENCE_LABEL[family.confidence] ?? family.confidence}）
              </span>
            </p>
            <ol className="mt-1 space-y-0.5">
              {family.actions.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-foreground/80">
                  <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 break-words">{a}</span>
                </li>
              ))}
            </ol>
          </div>

          <ul className="mt-2 divide-y divide-border/40">
            {chains.slice(0, 5).map((c) => (
              <li key={c.spanId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-[11px]">
                <span className="font-mono text-muted-foreground">{fmtTime(c.startedAt)}</span>
                <span className="rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">{c.tool}</span>
                <span className="text-muted-foreground">R{c.roundIndex + 1}</span>
                <span
                  className={cn(
                    "rounded-sm px-1 text-[10px]",
                    c.outcome === "fatal" || c.outcome === "retried_failed"
                      ? "bg-destructive/10 text-destructive"
                      : c.outcome === "abandoned"
                        ? "bg-warning/10 text-warning"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {OUTCOME_LABEL[c.outcome] ?? c.outcome}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground/70">{c.summary || "（无摘要）"}</span>
                <Link
                  href={`/trace/${c.sessionId}?spanId=${encodeURIComponent(c.spanId)}`}
                  className="inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline"
                >
                  链路
                  <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              </li>
            ))}
          </ul>
          {chains.length > 5 && (
            <p className="mt-1 text-[10px] text-muted-foreground">同类还有 {chains.length - 5} 条，未全部展开</p>
          )}
        </div>
      )}
    </li>
  );
}

/* ---------------- 命令级成败对照 ---------------- */

/**
 * 为什么要这一块：
 * 上面按 family 聚合回答的是「哪一类错、根因是什么」，但 tool 名（bash/shell）是万能容器，
 * 「bash 失败 12 次 26%」无法落到任何一行代码上。真正可行动的单位是一条具体命令：
 * python merge.py 调用 34 次失败 18 次，且失败与成功的命令**完全一致** —— 那就说明
 * 改命令没用，要去查它读的 deck.json。这块就是把事实摆出来，不下结论。
 */

const cmdKey = (c: CommandStat) => `${c.tool}|${c.signature}`;

/** 命令条数可能到 20 条，默认只展开前 8 条，避免整张卡片被列表撑长 */
const VISIBLE_COMMANDS = 8;

function rateBadge(rate: number): string {
  if (rate >= 50) return "bg-destructive/10 text-destructive";
  if (rate >= 20) return "bg-warning/10 text-warning";
  return "bg-muted text-muted-foreground";
}

/** 一行结论式摘要：不展开也能判断该不该点进去 */
function briefOf(c: CommandStat): { text: string; warn: boolean } {
  const d = c.argDiff;
  if (!d) return { text: "该命令从未成功过，没有可对照的成功样本", warn: true };
  if (d.identicalCommand) {
    return {
      text: d.sameSession
        ? "同任务重试，命令与参数完全相同 → 问题不在参数，在输入数据或环境状态"
        : "命令与参数完全相同 → 问题不在参数，在输入数据或环境状态",
      warn: true,
    };
  }
  const parts: string[] = [];
  // 单个 token 可能是一整段被替换的文本（edit 的 oldText），摘要行必须截断
  const clip = (t: string) => (t.length > 24 ? `${t.slice(0, 24)}…` : t);
  if (d.onlySuccess.length > 0) parts.push(`成功那次多出 ${d.onlySuccess.slice(0, 3).map(clip).join(" ")}`);
  if (d.onlyFailed.length > 0) parts.push(`仅失败有 ${d.onlyFailed.slice(0, 3).map(clip).join(" ")}`);
  if (parts.length === 0) return { text: "参数差异不落在单个词上（整段替换）", warn: false };
  return { text: parts.join("；"), warn: false };
}

function CommandSection({ commands }: { commands: CommandStat[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const active = openKey ?? cmdKey(commands[0]);
  const visible = showAll ? commands : commands.slice(0, VISIBLE_COMMANDS);

  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-[12px] font-medium">接口级成败对照</h4>
        <span className="text-[11px] leading-relaxed text-muted-foreground">
          按真实接口聚合（bash 下的具体命令、edit/write 的具体文件）：调用几次、失败几次、成功与失败的入参差在哪
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {visible.map((c) => (
          <CommandRow
            key={cmdKey(c)}
            stat={c}
            open={active === cmdKey(c)}
            onToggle={() => setOpenKey(active === cmdKey(c) ? "" : cmdKey(c))}
          />
        ))}
      </ul>
      {commands.length > VISIBLE_COMMANDS && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1.5 text-[10.5px] text-primary hover:underline"
        >
          {showAll ? "收起" : `还有 ${commands.length - VISIBLE_COMMANDS} 条失败命令，展开`}
        </button>
      )}
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        仅列出至少失败过一次的接口/命令，按失败次数排序；入参为原始内容原文，未做任何改写或补全。
      </p>
    </div>
  );
}

function CommandRow({ stat, open, onToggle }: { stat: CommandStat; open: boolean; onToggle: () => void }) {
  const brief = briefOf(stat);
  const d = stat.argDiff;

  return (
    <li className="rounded-lg bg-muted/30 ring-1 ring-foreground/[0.04]">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="rounded-sm bg-background/70 px-1 py-px font-mono text-[11px] text-foreground">
              {stat.label}
            </code>
            <span className={cn("rounded-sm px-1 py-px text-[10px] font-medium tabular-nums", rateBadge(stat.failRate))}>
              {stat.failRate.toFixed(0)}%
            </span>
            <span className="text-[11px] text-muted-foreground">
              调用 <span className="font-mono tabular-nums text-foreground">{stat.calls}</span> · 失败{" "}
              <span className="font-mono tabular-nums text-foreground">{stat.failures}</span>
            </span>
            <span className="text-[10px] text-muted-foreground">
              · p50 {formatDuration(stat.p50DurationMs)}
            </span>
          </div>
          <p
            className={cn(
              "mt-0.5 break-words text-[11px] leading-relaxed",
              brief.warn ? "text-warning" : "text-muted-foreground",
            )}
          >
            {brief.text}
          </p>
        </div>
        <ChevronDown
          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-border/40 px-3 pb-3 pt-2">
          {d && !d.sameSession && (
            <p className="rounded-sm bg-muted px-1.5 py-1 text-[10.5px] leading-relaxed text-muted-foreground">
              对照样本来自不同任务，参数差异仅供参考；只有同任务重试的差异才说明「改了什么才成功」。
            </p>
          )}

          {d && (d.onlyFailed.length > 0 || d.onlySuccess.length > 0) && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-muted-foreground">成功多出</span>
              {d.onlySuccess.length === 0 ? (
                <span className="text-[10px] text-muted-foreground/60">无</span>
              ) : (
                d.onlySuccess.map((t, i) => (
                  <code
                    key={`s${i}`}
                    title={t}
                    className="max-w-[260px] truncate rounded-sm bg-success/10 px-1 py-px font-mono text-[10px] text-success"
                  >
                    {t}
                  </code>
                ))
              )}
              <span className="ml-1 text-[10px] text-muted-foreground">仅失败有</span>
              {d.onlyFailed.length === 0 ? (
                <span className="text-[10px] text-muted-foreground/60">无</span>
              ) : (
                d.onlyFailed.map((t, i) => (
                  <code
                    key={`f${i}`}
                    title={t}
                    className="max-w-[260px] truncate rounded-sm bg-destructive/10 px-1 py-px font-mono text-[10px] text-destructive"
                  >
                    {t}
                  </code>
                ))
              )}
            </div>
          )}

          <SampleList title="失败时" samples={stat.failedSamples} showError />
          <SampleList
            title="成功时"
            samples={stat.successSamples}
            note={d?.identicalCommand ? "参数与失败时完全相同" : undefined}
          />
        </div>
      )}
    </li>
  );
}

function SampleList({
  title,
  samples,
  showError,
  note,
}: {
  title: string;
  samples: CommandSample[];
  showError?: boolean;
  note?: string;
}) {
  if (samples.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10.5px] font-medium text-muted-foreground">{title}</span>
        {note && <span className="text-[10px] text-muted-foreground/70">{note}</span>}
      </div>
      <ul className="mt-1 space-y-1">
        {samples.map((s) => (
          <li key={s.spanId} className="rounded-md bg-background/60 p-1.5 ring-1 ring-foreground/[0.03]">
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-foreground/85">
              {s.command}
            </pre>
            {showError && s.errorSummary && (
              <p className="mt-1 line-clamp-3 break-all border-t border-border/40 pt-1 font-mono text-[10px] leading-relaxed text-destructive/90">
                {s.errorSummary}
              </p>
            )}
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>R{s.roundIndex + 1}</span>
              <span>{formatDuration(s.durationMs)}</span>
              <Link
                href={`/trace/${s.sessionId}?spanId=${encodeURIComponent(s.spanId)}`}
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                链路
                <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
