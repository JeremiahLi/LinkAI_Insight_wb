/**
 * 症状复发：同一个失败家族是不是「改过又回来了」。
 *
 * 为什么需要（实测依据）：全库 166 个失败家族里，40 个跨 ≥2 个会话复发、20 个跨 ≥2 周复发，
 * `pi-coding-agent` 的 command_not_found 在近 3 个月跨 5 个会话反复出现。也就是说，
 * 现有那套检测「每次都能看见它」，但没有任何东西回答「上个月不是说修好了？」。
 *
 * 这里只做事实统计，不做修复状态判断 —— 状态（已修复/已忽略）要独立存，不能靠推断。
 *
 * 两个必须讲清的口径：
 *   1. **触发率的分母是「该家族涉及的工具在该周的调用次数」**，不是会话数。用会话数做分母
 *      会在长会话里严重低估（一个会话可以调 46 次 bash）。
 *   2. **「本周期没出现」不等于「修好了」**：可能只是没走到那条路径。所以必须显示分母，
 *      让用户自己判断是「真不犯了」还是「没做那个操作」。
 */

import { ERROR_KIND_LABEL, signatureOf, type ErrorSignatureKind } from "./error-signature";

export interface RecurrenceSpanInput {
  id: string;
  sessionId: string;
  name: string;
  status: string;
  error?: string | null;
  /** 毫秒时间戳 */
  at: number;
}

export interface RecurrenceBucket {
  /** 周一 00:00 的毫秒时间戳 */
  weekStartMs: number;
  /** 该家族在本周出现的次数 */
  count: number;
  /** 本周分母：该家族涉及工具的调用总次数 */
  calls: number;
}

export interface RecurrenceRow {
  family: string;
  kind: ErrorSignatureKind;
  kindLabel: string;
  summary: string;
  /** 窗口内总出现次数 */
  total: number;
  sessionCount: number;
  /** 出现过的周数（>=2 记为复发） */
  activeWeeks: number;
  recurred: boolean;
  /** 触发率（%）= total / 各周 calls 之和 × 100 */
  rate: number;
  buckets: RecurrenceBucket[];
  lastAtMs: number;
  sampleSpanId: string;
  sampleSessionId: string;
  /** 涉及的接口（tool name），用于 UI 说明分母口径 */
  tools: string[];
}

export interface RecurrenceReport {
  weeks: number;
  weekStarts: number[];
  rows: RecurrenceRow[];
  /** 窗口内有失败家族出现的会话数 / 窗口内总会话数由调用方补 */
  totalFailures: number;
  families: number;
  recurredFamilies: number;
}

/** 周一 00:00（本地时区），用于把 span 归到周桶 */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  // getDay: 0=周日，转成「距最近周一的天数」
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 生成最近 weeks 周的桶起点（含本周，升序） */
export function weekBuckets(weeks: number, nowMs = Date.now()): number[] {
  const cur = weekStart(nowMs);
  const out: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) out.push(cur - i * WEEK_MS);
  return out;
}

/**
 * @param spans 同一 Agent + 窗口内的全部 tool_call / command span（**成败都要**，
 *              失败用于取样，成功用于分母）
 * @param weeks 周数
 */
export function buildRecurrence(spans: RecurrenceSpanInput[], weeks: number, nowMs = Date.now()): RecurrenceReport {
  const weekStarts = weekBuckets(weeks, nowMs);
  const weekIndex = new Map(weekStarts.map((w, i) => [w, i]));
  const idxOf = (ms: number): number | null => {
    const i = weekIndex.get(weekStart(ms));
    return i === undefined ? null : i;
  };

  // 分母：每周 × 每个接口的调用次数
  const calls = new Map<string, number>();
  const callKey = (wi: number, tool: string) => `${wi}\u0000${tool}`;
  for (const sp of spans) {
    const wi = idxOf(sp.at);
    if (wi === null) continue;
    const tool = (sp.name || "unknown").trim().toLowerCase();
    calls.set(callKey(wi, tool), (calls.get(callKey(wi, tool)) ?? 0) + 1);
  }

  interface Acc {
    family: string;
    kind: ErrorSignatureKind;
    summary: string;
    total: number;
    sessions: Set<string>;
    tools: Set<string>;
    counts: number[];
    lastAt: number;
    sampleSpanId: string;
    sampleSessionId: string;
  }
  const acc = new Map<string, Acc>();
  let totalFailures = 0;

  for (const sp of spans) {
    if (sp.status === "success") continue;
    if (!sp.error || !sp.error.trim()) continue;
    const sig = signatureOf({ error: sp.error, name: sp.name, status: sp.status });
    // 采集端把正常输出写进 error 的脏数据，不参与复发统计
    if (sig.kind === "not_an_error") continue;
    const wi = idxOf(sp.at);
    if (wi === null) continue;

    totalFailures += 1;
    const tool = (sp.name || "unknown").trim().toLowerCase();
    let cur = acc.get(sig.family);
    if (!cur) {
      cur = {
        family: sig.family,
        kind: sig.kind,
        summary: sig.summary,
        total: 0,
        sessions: new Set(),
        tools: new Set(),
        counts: new Array(weeks).fill(0) as number[],
        lastAt: 0,
        sampleSpanId: sp.id,
        sampleSessionId: sp.sessionId,
      };
      acc.set(sig.family, cur);
    }
    cur.total += 1;
    cur.sessions.add(sp.sessionId);
    cur.tools.add(tool);
    cur.counts[wi] += 1;
    if (sp.at > cur.lastAt) {
      cur.lastAt = sp.at;
      cur.sampleSpanId = sp.id;
      cur.sampleSessionId = sp.sessionId;
    }
  }

  const rows: RecurrenceRow[] = [...acc.values()]
    .map((a) => {
      const tools = [...a.tools];
      const buckets: RecurrenceBucket[] = a.counts.map((count, wi) => {
        let c = 0;
        for (const t of tools) c += calls.get(callKey(wi, t)) ?? 0;
        return { weekStartMs: weekStarts[wi], count, calls: c };
      });
      const totalCalls = buckets.reduce((s, b) => s + b.calls, 0);
      const activeWeeks = a.counts.filter((n) => n > 0).length;
      return {
        family: a.family,
        kind: a.kind,
        kindLabel: ERROR_KIND_LABEL[a.kind] ?? a.kind,
        summary: a.summary,
        total: a.total,
        sessionCount: a.sessions.size,
        activeWeeks,
        recurred: activeWeeks >= 2,
        rate: totalCalls > 0 ? (a.total / totalCalls) * 100 : 0,
        buckets,
        lastAtMs: a.lastAt,
        sampleSpanId: a.sampleSpanId,
        sampleSessionId: a.sampleSessionId,
        tools,
      };
    })
    // 复发优先，其次出现次数；只出现一次的不叫「复发」，但仍保留（可能是新问题）
    .sort((x, y) => Number(y.recurred) - Number(x.recurred) || y.total - x.total);

  return {
    weeks,
    weekStarts,
    rows,
    totalFailures,
    families: rows.length,
    recurredFamilies: rows.filter((r) => r.recurred).length,
  };
}
