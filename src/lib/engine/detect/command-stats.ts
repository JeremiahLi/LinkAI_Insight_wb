/**
 * 命令级聚合：把「bash 失败 12 次（26.1%）」这种无法行动的结论，拆到
 * 「python merge.py 调用 8 次、失败 6 次、失败时长这样、成功时长这样」。
 *
 * 为什么需要（用户视角的实测反馈）：
 * 「检查该工具入参构造」对开发者没有信息量 —— bash 是万能容器，26% 的失败率
 * 无法定位到任何一行代码。真正能行动的单位是**同一条命令的成败对照**：
 * 同一个 python merge.py，失败那次传了什么、成功那次传了什么，差在哪。
 *
 * 数据来源全部在库里（Span.input + Span.error），不需要 LLM、不需要新采集。
 * 纯函数，可单测。
 */

/**
 * 按文件路径识别的工具（签名用文件名，不用命令行）。
 *
 * 这里**故意不合并** edit / edit_file / write：它们是不同的工具接口，入参结构不同
 * （edit 有 edits[].oldText，write 只有 path+content）。实测库里 write 856 次、
 * edit_file 634 次、edit 457 次，一旦按 normalizeToolName 折成同一个 edit，
 * 就会出现「拿 write 的入参当 edit 的成功对照」，差异结论完全是假的。
 */
const FILE_TOOLS = new Set(["edit", "edit_file", "write", "write_file", "read", "read_file", "cat"]);

export interface CommandSpanInput {
  id: string;
  sessionId: string;
  roundIndex: number;
  kind: string;
  name: string;
  status: string;
  input?: string | null;
  error?: string | null;
  duration?: number | null;
}

export interface CommandSample {
  spanId: string;
  sessionId: string;
  roundIndex: number;
  /** 原始参数/命令（截断 600 字），直接给人看 */
  command: string;
  /** 失败样例才有 */
  errorSummary?: string;
  durationMs: number;
}

export interface CommandStat {
  tool: string;
  /** 归一化签名，如 python merge.py / npm run dev / edit:deck.json */
  signature: string;
  /** 更完整一点的可读标题，用于 UI 主文案 */
  label: string;
  calls: number;
  failures: number;
  failRate: number;
  p50DurationMs: number;
  failedSamples: CommandSample[];
  successSamples: CommandSample[];
  /**
   * 成败参数差异。null 表示没有成功样本可对照。
   *
   * identicalCommand 是最有价值的信号：同一条命令、同样的参数，一次成功一次失败，
   * 说明问题不在命令本身，而在它读写的输入数据或环境状态。
   * 实测 python merge.py 34 次调用 18 次失败且命令完全一致 —— 对应 deck.json
   * 内容触发 pydantic 校验，改命令参数没有任何用。
   *
   * sameSession 表示对照样本来自同一会话（同任务重试）。跨任务的参数差异没有
   * 因果意义 —— 不同任务本来就传不同文件，据此改命令会改错方向。
   */
  argDiff: {
    onlyFailed: string[];
    onlySuccess: string[];
    identicalCommand: boolean;
    sameSession: boolean;
  } | null;
}

const MAX_SAMPLES = 3;
const MAX_COMMAND_CHARS = 600;
const MAX_DIFF_TOKENS = 12;

/**
 * extractPayload 给 edit 类工具拼的可读分隔行。
 * tokenDiff 必须把它剔掉，否则 diff 里会出现 `---`、`待替换片段` 这种**我们自己造的**噪声，
 * 用户会误以为是参数里的东西。实测 edit 失败样例的 diff 就是这么被污染的。
 */
const OLD_TEXT_MARKER = "--- 待替换片段 ---";

/** 从 span.input 里取出人能读的命令/参数 */
export function extractPayload(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  // 多数工具的 input 是 JSON：{"command": "..."} / {"path": "...", "old_string": "..."}
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const cmd = j.command ?? j.cmd ?? j.script;
    if (typeof cmd === "string" && cmd.trim()) return cmd.trim();
    const path = j.path ?? j.file_path ?? j.filePath;
    // edit 的真实结构是 { path, edits: [{ oldText, newText }] }；
    // oldText 就是「失败时的参数」—— 定位失败时最该给人看的就是它
    const edits = j.edits;
    if (Array.isArray(edits) && edits.length > 0) {
      const first = edits[0] as Record<string, unknown> | undefined;
      const oldText = first?.oldText ?? first?.old_string ?? first?.oldString;
      const head = typeof path === "string" ? path : "";
      if (typeof oldText === "string" && oldText.trim()) {
        return `${head}\n${OLD_TEXT_MARKER}\n${oldText.trim()}`;
      }
    }
    if (typeof path === "string") {
      const oldStr = j.old_string ?? j.oldText;
      return typeof oldStr === "string" && oldStr
        ? `${path}\n${OLD_TEXT_MARKER}\n${oldStr}`
        : path;
    }
    // 兜底：取第一个**短**字符串值，避免整段正文糊在界面上（长文本不是参数，是内容）
    for (const v of Object.values(j)) {
      if (typeof v === "string" && v.trim() && v.length <= 200) return v.trim();
    }
    return null;
  } catch {
    // JSON 解析失败有两种情况，都必须靠正则兜底：
    //   1) 旧数据/纯文本 input（原样就是命令）
    //   2) **被上游截断的 JSON**（这里实测踩过：SQL 取 substr 400 字后中断，
    //      直接原样返回会产出 `{"command":"cd` 这种垃圾签名，还进了问题标题）
    return extractPayloadLenient(raw);
  }
}

/** 从（可能被截断的）JSON 文本里正则捞出关键字段，不做完整解析 */
function extractPayloadLenient(raw: string): string | null {
  const grab = (key: string): string | null => {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) return null;
    const v = m[1].trim();
    if (!v) return null;
    // 捕获组是 JSON 字符串的裸内容，反转义后才能还原换行/引号
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return v;
    }
  };

  const cmd = grab("command") ?? grab("cmd") ?? grab("script");
  if (cmd) return cmd;

  const path = grab("path") ?? grab("file_path");
  const oldText = grab("oldText") ?? grab("old_string");
  if (path && oldText) return `${path}\n${OLD_TEXT_MARKER}\n${oldText}`;
  if (path) return path;

  // 完全不是 JSON（旧版纯文本 input）就原样用；否则说明这段文本没有可读字段
  return raw.startsWith("{") ? null : raw;
}

function baseName(p: string): string {
  const clean = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const seg = clean.split("/").filter(Boolean).pop() ?? clean;
  return seg;
}

/**
 * 命令签名归一化。
 *
 * 目标是稳定且可读：同一件事的多次调用归到一起，但不要把不同脚本混为一谈。
 *   python .pi/renderer/merge.py a b --title "x"  → python merge.py
 *   npm run dev                                  → npm run dev
 *   git status                                   → git status
 *   ls -la src/                                  → ls
 *   长串 cd && 串联命令                          → 取第一个非 cd 的主命令
 */
export function normalizeCommandSignature(payload: string, tool: string): { signature: string; label: string } {
  if (FILE_TOOLS.has(tool)) {
    const firstLine = payload.split(/\r?\n/)[0] ?? "";
    const name = baseName(firstLine);
    return { signature: `${tool}:${name}`, label: `${tool} ${name}` };
  }

  // 多行 heredoc：python << 'PY' ... PY
  const heredoc = payload.match(/^([A-Za-z_][\w.-]*)\s*<</);
  if (heredoc) {
    return { signature: `${heredoc[1]} inline-script`, label: `${heredoc[1]} 内联脚本` };
  }

  // 按连接符切段，跳过两类噪声段：
  //   - 纯 cd：不产生失败语义，且路径噪声大
  //   - 纯续行符（`\` / `^`）：多行命令按 && 切开后，行尾的续行符会独立成段
  const segments = payload
    .split(/\r?\n/)
    .flatMap((line) => line.split(/&&|\|\||;/))
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^[\\^]+$/.test(s));
  const significant =
    segments.find((s) => !/^cd\s/.test(s)) ?? segments[0] ?? payload;

  const tokens = significant.split(/\s+/).filter(Boolean);
  // 去掉包裹字符：命令可能以引号开头，也可能是被截断的 `\\?\E:\...` 长路径（首个 token 只剩反斜杠）
  const head = (tokens[0] ?? "").replace(/^[("'\\]+/, "");
  if (!head || !/[\w.\/-]/.test(head)) return { signature: "unknown", label: "未知命令" };

  const h = head.toLowerCase();

  // npm/pnpm/yarn run <script>
  if (/^(npm|pnpm|yarn|bun)$/.test(h) && /^(run|run-script)$/.test((tokens[1] ?? "").toLowerCase())) {
    const script = tokens[2] ?? "";
    return { signature: `${h} run ${script}`.trim(), label: `${h} run ${script}`.trim() };
  }
  if (/^(npm|pnpm|yarn|bun)$/.test(h)) {
    const sub = tokens[1] ?? "";
    return { signature: `${h} ${sub}`.trim(), label: `${h} ${sub}`.trim() };
  }

  // git <subcommand>
  if (h === "git") {
    const sub = tokens[1] ?? "";
    return { signature: `git ${sub}`.trim(), label: `git ${sub}`.trim() };
  }

  // 解释器 + 脚本文件：python / python3 / node / npx / tsx
  if (/^(python|python3|py|node|npx|tsx|deno|bash|sh)$/.test(h)) {
    // 内联脚本 python -c "..." / node -e "..."：
    // 不能取 -c 后面那一段（会被空格切碎，实测签名退化成 `python "`）
    const inlineIdx = tokens.findIndex((t) => /^-[ce]$/.test(t));
    if (inlineIdx >= 0) {
      return { signature: `${h} ${tokens[inlineIdx]}`, label: `${h} ${tokens[inlineIdx]} 内联脚本` };
    }
    const arg = tokens.slice(1).find((t) => !t.startsWith("-"));
    if (arg) {
      const name = baseName(arg);
      if (name && !name.startsWith("-")) {
        return { signature: `${h} ${name}`, label: `${h} ${name}` };
      }
    }
    return { signature: h, label: h };
  }

  // 其余：只取命令名（ls / rm / cp / curl / find …）
  return { signature: h, label: h };
}

/** token 级差集：只保留有意义的差异片段，供 UI 展示 */
function tokenDiff(failed: string, success: string): { onlyFailed: string[]; onlySuccess: string[] } | null {
  /** 分隔标记是我们自己拼的，不参与比较（否则 diff 里会冒出 `---`/`待替换片段`） */
  const dropMarker = (s: string) => s.replace(new RegExp(`^${OLD_TEXT_MARKER}$`, "gm"), " ");
  const split = (raw: string) =>
    dropMarker(raw)
      .replace(/\s+/g, " ")
      .split(" ")
      .map((t) => t.trim())
      // 长度 <=1 与纯符号 token（&&、管道、反引号）不携带语义，只会占满 UI
      .filter((t) => t.length > 1 && /[\w\u4e00-\u9fa5]/.test(t));

  const a = split(failed);
  const b = split(success);
  const countOf = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const t of arr) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  const ca = countOf(a);
  const cb = countOf(b);

  const onlyFailed: string[] = [];
  for (const [t, n] of ca) {
    const other = cb.get(t) ?? 0;
    if (n > other) onlyFailed.push(t);
  }
  const onlySuccess: string[] = [];
  for (const [t, n] of cb) {
    const other = ca.get(t) ?? 0;
    if (n > other) onlySuccess.push(t);
  }

  const trim = (arr: string[]) => arr.slice(0, MAX_DIFF_TOKENS);
  const of = trim(onlyFailed);
  const os = trim(onlySuccess);
  if (of.length === 0 && os.length === 0) return null;
  return { onlyFailed: of, onlySuccess: os };
}

function p50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 按「工具 + 命令签名」聚合调用与失败，并抽取成败对照样本。
 *
 * @param spans 同一 Agent + 时间窗内的 tool_call / command span
 * @param limit 返回条数上限（按失败次数降序）
 */
export function buildCommandStats(spans: CommandSpanInput[], limit = 20): CommandStat[] {
  interface Bucket {
    tool: string;
    signature: string;
    label: string;
    calls: number;
    failures: number;
    durations: number[];
    failed: CommandSample[];
    success: CommandSample[];
    /** 每个会话的第一个失败/成功样本，用于同任务重试配对 */
    failBySession: Map<string, CommandSample>;
    okBySession: Map<string, CommandSample>;
  }

  const buckets = new Map<string, Bucket>();

  for (const sp of spans) {
    if (sp.kind !== "tool_call" && sp.kind !== "command") continue;
    // 用原始接口名（不做别名合并）：edit / edit_file / write 是三个不同接口，
    // 入参结构不同，混在一起会让「成功参数」和「失败参数」根本不是同一回事
    const tool = (sp.name || "unknown").trim().toLowerCase();
    const payload = extractPayload(sp.input);
    if (!payload) continue;

    const { signature, label } = normalizeCommandSignature(payload, tool);
    const key = `${tool}|${signature}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        tool,
        signature,
        label,
        calls: 0,
        failures: 0,
        durations: [],
        failed: [],
        success: [],
        failBySession: new Map(),
        okBySession: new Map(),
      };
      buckets.set(key, bucket);
    }

    bucket.calls += 1;
    if (typeof sp.duration === "number" && sp.duration > 0) bucket.durations.push(sp.duration);

    const failed = sp.status !== "success" && !!(sp.error && sp.error.trim());
    const sample: CommandSample = {
      spanId: sp.id,
      sessionId: sp.sessionId,
      roundIndex: sp.roundIndex,
      command: payload.slice(0, MAX_COMMAND_CHARS),
      durationMs: sp.duration ?? 0,
    };

    if (failed) {
      bucket.failures += 1;
      if (bucket.failed.length < MAX_SAMPLES) {
        bucket.failed.push({ ...sample, errorSummary: (sp.error ?? "").split(/\r?\n/).slice(0, 3).join(" ").slice(0, 400) });
      }
      if (!bucket.failBySession.has(sp.sessionId)) {
        bucket.failBySession.set(sp.sessionId, { ...sample, errorSummary: (sp.error ?? "").slice(0, 400) });
      }
    } else {
      if (bucket.success.length < MAX_SAMPLES) bucket.success.push(sample);
      if (!bucket.okBySession.has(sp.sessionId)) bucket.okBySession.set(sp.sessionId, sample);
    }
  }

  return [...buckets.values()]
    .filter((b) => b.failures > 0)
    .map((b) => {
      /**
       * 配对优先级：
       * 1. 同会话的失败/成功对 —— 同任务重试，差异才是「改了什么才成功」
       * 2. 全局失败/成功首样本 —— 只能说明参数分布，标 sameSession=false 供 UI 降级提示
       */
      let pair: { failed: CommandSample; success: CommandSample; sameSession: boolean } | null = null;
      for (const [sid, f] of b.failBySession) {
        const ok = b.okBySession.get(sid);
        if (ok) {
          pair = { failed: f, success: ok, sameSession: true };
          break;
        }
      }
      if (!pair && b.failed[0] && b.success[0]) {
        pair = { failed: b.failed[0], success: b.success[0], sameSession: false };
      }

      let argDiff: CommandStat["argDiff"] = null;
      if (pair) {
        const d = tokenDiff(pair.failed.command, pair.success.command);
        const norm = (x: string) => x.replace(/\s+/g, " ").trim();
        argDiff = {
          onlyFailed: d?.onlyFailed ?? [],
          onlySuccess: d?.onlySuccess ?? [],
          identicalCommand: norm(pair.failed.command) === norm(pair.success.command),
          sameSession: pair.sameSession,
        };
      }
      return {
        tool: b.tool,
        signature: b.signature,
        label: b.label,
        calls: b.calls,
        failures: b.failures,
        failRate: b.calls > 0 ? (b.failures / b.calls) * 100 : 0,
        p50DurationMs: p50(b.durations),
        failedSamples: b.failed,
        successSamples: b.success,
        argDiff,
      };
    })
    .sort((a, b) => b.failures - a.failures || b.failRate - a.failRate)
    .slice(0, limit);
}
