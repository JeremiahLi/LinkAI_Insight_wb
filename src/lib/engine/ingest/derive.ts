/**
 * 入库派生字段（纯函数，无 prisma 依赖）。
 *
 * 设计背景（每条都对应实测数据）：
 * 1. 采集端从未上报过 session_start span（全库 0 条），agent_name 恒走 fallback，
 *    导致所有 pi 会话都挂在同一个 Agent 上。因此这里补一层「从 span 内容反推工作目录」
 *    的兜底：tool_call 的 input 里有绝对路径（含 .pi/skills 锚点与 cd 命令），
 *    足以还原 agent 所在目录名。
 * 2. Project.name 此前被写成 projectId（16 位 hex），列表完全不可读。
 * 同一函数给出可读目录名。
 * 3. 旧口径「任一 span failed 即整会话失败」会把「质检关卡回流后最终交付」误判为失败：
 *    实测某会话 3 个 answer 全 success，但有 13 个 tool_call 失败（bash 校验退出码 1）。
 *    故引入 outcome 三态，详见 computeOutcome。
 * 4. 2026-11-04 口径修正（实测 68 个 partial 里 37 个工具失败全部自愈、8 个根本无工具
 *    失败，partial 低估成功率约 8.4pp）：partial 只认「未自愈的失败」——工具失败经
 *    failure-chain 判为 retried_recovered 的不计入；新增 truncated 终态识别假失败
 *    （末轮无输出但此前有交付、且无新追问 → 采集端收尾补写的空 answer）。
 */

import { extractFailureChains } from "../detect/failure-chain";
import { signatureOf } from "../detect/error-signature";

export type SessionOutcome = "success" | "partial" | "failed" | "truncated" | "";

export interface InSpanLike {
  /** failure-chain 需要稳定 id 标识被自愈覆盖的失败 span；缺省时按数组下标兜底 */
  id?: string;
  kind?: string;
  name?: string;
  status?: string;
  input?: string | null;
  output?: string | null;
  /** 错误文本：与采集端 Span.error 同源（isError 时的 output），自愈判定依赖它 */
  error?: string | null;
  isError?: boolean;
  roundIndex?: number;
  turnId?: number;
  agent_name?: string;
}

/** 标题长度上限（列表列宽约 20 个汉字，留出省略号余量） */
const TITLE_MAX = 60;

function normalizeText(raw: string): string {
  return raw
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 取路径最后一段，兼容 Windows 与 POSIX 分隔符 */
export function basenameOf(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]+/);
  return parts[parts.length - 1] || "";
}

/**
 * 输出目录 / 构建目录等「子目录名」不是项目根：命中黑名单就回退到上一级。
 * 典型误判：`cd /e/proj/outputs && python tools/x.py` 会把 agent 叫成 outputs。
 */
const IGNORED_LEAF = new Set([
  "output", "outputs", "dist", "build", "node_modules", "src", "tmp", "temp",
  "test", "tests", "doc", "docs", "assets", "tools", "scripts", "logs", "cache",
]);

function projectNameOf(fullPath: string): string {
  let p = fullPath.replace(/[\\/]+$/, "");
  let leaf = basenameOf(p);
  let guard = 0;
  while (IGNORED_LEAF.has(leaf.toLowerCase()) && guard++ < 4) {
    const next = p.replace(/[\\/][^\\/]+$/, "");
    if (next === p) break;
    p = next;
    leaf = basenameOf(p);
  }
  return leaf;
}

/**
 * 从 tool_call 的 input 里提取工作目录候选。
 *
 * 两类锚点（按可靠性排序）：
 * - `.pi/skills/...` 前缀：`<root>\.pi\skills\x\SKILL.md` → `<root>`
 * - bash 的 `cd <path>`：`cd /e/a/b && ...` 或 `cd "E:\a\b"`
 *
 * 只认绝对路径（盘符或根斜杠），相对路径会有歧义。
 */
function cwdCandidatesFrom(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];

  // .pi 锚点：截到 .pi 之前
  const piRe = /([A-Za-z]:[\\/][^\s"'<>|]*?)[\\/]\.pi[\\/]/g;
  let m: RegExpExecArray | null;
  while ((m = piRe.exec(input)) !== null) out.push(m[1]);

  // POSIX 版 .pi 锚点（/e/xxx/.pi/）
  const piPosix = /(\/[^\s"'<>|]*?)\/\.pi\//g;
  while ((m = piPosix.exec(input)) !== null) out.push(m[1]);

  // cd 命令
  const cdRe = /cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;|]+))/g;
  while ((m = cdRe.exec(input)) !== null) {
    const p = m[1] || m[2] || m[3];
    if (p && (/^[A-Za-z]:[\\/]/.test(p) || /^\/[A-Za-z]?\//.test(p) || /^\/[a-z]\//.test(p))) {
      out.push(p);
    }
  }

  return out.map((s) => s.replace(/[\\/]+$/, "")).filter((s) => s.length > 2);
}

/**
 * 推导会话所属工作目录：所有 tool_call 里出现次数最多的候选。
 * 用众数而非首个，避免单条命令里 cd 到子目录把根目录带偏。
 */
export function deriveWorkspace(spans: InSpanLike[]): string | null {
  const counts = new Map<string, number>();
  for (const sp of spans) {
    if (sp.kind !== "tool_call" && sp.kind !== "command") continue;
    for (const c of cwdCandidatesFrom(sp.input)) {
      // Windows 路径统一大小写比较，避免 E: 与 e: 分裂
      const key = /^[A-Za-z]:/.test(c) ? c.toLowerCase() : c;
      const hit = counts.get(key);
      if (hit) counts.set(key, hit + 1);
      else counts.set(key, 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/** 工作目录 → 可读名（项目根目录 basename，跳过 outputs/build 之类的子目录） */
export function workspaceLabel(spans: InSpanLike[]): string | null {
  const ws = deriveWorkspace(spans);
  if (!ws) return null;
  const name = projectNameOf(ws);
  return name || null;
}

/**
 * Agent 名字四级兜底（越靠前越可信）：
 *   1. session_start span 的 agent_name（契约字段，采集端未来应补齐）
 *   2. 任一 span 上的 agent_name（部分采集端逐条上报）
 *   3. 工作目录 basename（从 tool_call 路径反推，无需采集端改动）
 *   4. 框架名兜底
 */
export function deriveAgentName(spans: InSpanLike[], explicit?: string | null, fallback = "pi-coding-agent"): string {
  if (explicit && explicit.trim()) return explicit.trim();
  for (const sp of spans) {
    if (sp.agent_name && sp.agent_name.trim()) return sp.agent_name.trim();
  }
  return workspaceLabel(spans) ?? fallback;
}

/** 标题：首条用户诉求 → 兜底末条 answer 首句 → 空串 */
export function deriveTitle(spans: InSpanLike[]): string {
  const users = spans
    .filter((s) => s.kind === "user" || s.kind === "input")
    .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0) || (a.turnId ?? 0) - (b.turnId ?? 0));
  for (const u of users) {
    const t = normalizeText(u.input ?? "");
    if (t) return t.slice(0, TITLE_MAX);
  }
  const answers = spans.filter((s) => s.kind === "answer");
  const last = answers[answers.length - 1];
  const t = normalizeText(last?.output ?? "");
  return t ? t.slice(0, TITLE_MAX) : "";
}

/**
 * 会话终态判定（四态 + 未知）。
 *
 * 判定基准是「末条 answer 有没有交付」，而不是「有没有出现过 failed span」：
 * - 无 span：""（未知，不计入成功率分母，避免空会话拉低/抬高）
 * - 有 span 但无 answer，或末条 answer 失败/空输出：failed（真正没交付）
 *   - 例外：末条 answer 空输出但此前有过非空交付、且之后没有新的 user 追问
 *     → truncated（假失败，多为采集端收尾时补写的空 answer span；实测 18 条
 *       failed 里 9 条属于这种）。truncated 暂按 failed 计入成功率（SQL_BAD），
 *       详情页单独标注，观察两周后再决定是否剔除分母。
 * - 末条 answer 成功且有输出，且过程失败全部自愈：success
 * - 末条 answer 成功且有输出，但存在未自愈的失败：partial
 *   （工具失败经 failure-chain 判 retried_recovered 的不算；answer/llm_thinking
 *     级失败始终算 —— 实测 8 个 partial 的失败发生在 answer 级而非工具级）
 */
export function computeOutcome(spans: InSpanLike[]): {
  outcome: SessionOutcome;
  /** 致命失败数（answer / llm_thinking 级） */
  fatalErrors: number;
  /** 过程失败总数（含工具级，保留为质量信号） */
  errors: number;
} {
  const errors = spans.filter((s) => s.status === "failed").length;
  const fatalErrors = spans.filter(
    (s) => s.status === "failed" && (s.kind === "answer" || s.kind === "llm_thinking"),
  ).length;

  if (spans.length === 0) return { outcome: "", fatalErrors, errors };

  // 全程按 (roundIndex, turnId) 排序：answer 定位、truncated 判定、failure-chain
  // 都依赖时间顺序。failure-chain 只看 roundIndex，但数组顺序必须先行正确。
  const ordered = [...spans].sort(
    (a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0) || (a.turnId ?? 0) - (b.turnId ?? 0),
  );

  const answers = ordered.filter((s) => s.kind === "answer");
  if (answers.length === 0) return { outcome: "failed", fatalErrors, errors };

  const last = answers[answers.length - 1];
  const delivered = last.status !== "failed" && (last.output ?? "").trim().length > 0;

  if (!delivered) {
    // 假失败识别：末条 answer 空，但此前有过非空交付。若交付之后没有新的 user
    // 追问，说明不是「用户追问未回复」（那才是真失败），而是会话在已有交付后被
    // 截断/收尾。位置比较用排序后的下标，不依赖 roundIndex 连续性。
    let lastDeliveredIdx = -1;
    for (let i = ordered.length - 1; i >= 0; i--) {
      const s = ordered[i];
      if (
        s.kind === "answer" &&
        s.status !== "failed" &&
        (s.output ?? "").trim().length > 0
      ) {
        lastDeliveredIdx = i;
        break;
      }
    }
    if (lastDeliveredIdx >= 0) {
      const hasNewAsk = ordered
        .slice(lastDeliveredIdx + 1)
        .some((s) => s.kind === "user");
      if (!hasNewAsk) return { outcome: "truncated", fatalErrors, errors };
    }
    return { outcome: "failed", fatalErrors, errors };
  }

  // 自愈判定：failure-chain 提取「失败 → 重试 → 结局」，retried_recovered 的
  // span 不再算过程失败。not_an_error（日志误写进 error）同样剔除，与
  // detect 层的失败判定口径一致。
  const chainSpans = ordered.map((s, i) => ({
    id: s.id ?? `#${i}`,
    roundIndex: s.roundIndex ?? 0,
    kind: s.kind ?? "",
    name: s.name ?? "",
    status: s.status ?? "",
    error: s.error ?? null,
    output: s.output ?? null,
  }));
  const recoveredIds = new Set(
    extractFailureChains(chainSpans)
      .filter((c) => c.outcome === "retried_recovered")
      .flatMap((c) => c.spanIds),
  );

  const unrecovered = chainSpans.some((s) => {
    if (s.status !== "failed") return false;
    if (s.kind === "answer" || s.kind === "llm_thinking") return true;
    if (s.kind !== "tool_call" && s.kind !== "command") return false;
    if (recoveredIds.has(s.id)) return false;
    // 日志误写不是失败（与 failure-chain 的 isFailure 剔除逻辑同源）
    const sig = signatureOf({ error: s.error, name: s.name, status: s.status });
    return sig.kind !== "not_an_error";
  });

  return { outcome: unrecovered ? "partial" : "success", fatalErrors, errors };
}
