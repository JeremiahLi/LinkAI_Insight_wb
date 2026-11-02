/**
 * 错误语义化：把自由文本的 `Span.error` 归一成可分类、可聚类的 ErrorSignature。
 *
 * 为什么需要这一层（实测依据，dev.db 243 会话 / 349 条工具错误）：
 * 1. `error` 字段语义不纯 —— 采集端把命令 stdout 也写进来了。实测 15 条以
 *    "OK:" / "WARN" 开头却 status=failed，其中既有真失败（内含 Traceback），
 *    也有纯日志前缀。直接按"error 非空即失败"归因会制造假故障。
 * 2. 四分之一的中文错误已损坏 —— 90/349 条含 U+FFFD（GBK 写入、UTF-8 解读）。
 *    但损坏的多是中文片段，Traceback 与异常类名通常是 ASCII，仍可分类。
 *    因此 garbled 作为**独立标志**而非 kind 值：标了乱码不等于放弃归类，
 *    否则会丢掉 90 条里可用的部分。
 * 3. 只有可聚合才有运维价值 —— 349 条原文里同一种失败出现几十次
 *    （pydantic ValidationError 42 次、exit 127 13 次）。key 做归一化，
 *    让"同一类问题"在跨会话、跨版本时可识别。
 *
 * 纯函数，无 prisma / 无 LLM 依赖，可单测。
 */

export type ErrorSignatureKind =
  /** 文本是日志/成功输出，被采集端误写进 error（应从失败样本剔除） */
  | "not_an_error"
  /** 命令或可执行文件不存在（exit 127 / command not found） */
  | "command_not_found"
  /** 编码不匹配（UnicodeEncode/DecodeError、codec、gbk） */
  | "encoding"
  /** 有明确异常类（Traceback 或 XxxError: 形式） */
  | "exception"
  /** 权限不足（EACCES / EPERM / Permission denied） */
  | "permission"
  /** 路径不存在（No such file / cannot access / FileNotFoundError） */
  | "missing_path"
  /** 其他文件系统错误（EISDIR / ENOTDIR / ENOSPC / EIO） */
  | "io_error"
  /** shell 命令自身的语法错误：引号未闭合、重定向歧义、意外 token */
  | "shell_syntax"
  /** 编辑工具定位失败：old text 不匹配、替换后内容无变化 */
  | "edit_mismatch"
  /** 生成的 JSON 不合法（手写拼接、截断、尾逗号） */
  | "json_invalid"
  /** 入参越界或非法（offset 超出文件、索引越界） */
  | "invalid_argument"
  /** 超时 */
  | "timeout"
  /** 仅能拿到退出码，无更具体信息 */
  | "exit_code"
  /** 无法归类，保留摘要供人工判断 */
  | "unknown"
  /** 用户主动中止（不是故障，不应告警） */
  | "interrupted";

export interface ErrorSignature {
  kind: ErrorSignatureKind;
  /** 细粒度指纹：同类失败得到相同 key，用于聚类与 Issue.fingerprint */
  key: string;
  /**
   * 粗粒度家族：抹掉具体路径后的类别，用于「哪类问题占大头」的排行。
   *
   * 两级并存的原因：单用 key 时，349 条错误被切成 190 组（路径带 session 特征），
   * 用户面对 190 个"问题"无从下手；单用 family 又无法追踪"某个文件的问题是否已修"。
   * 排行用 family，下钻与修复验证用 key。
   */
  family: string;
  /** 命令退出码（若文本中出现） */
  exitCode?: number;
  /** 异常类名，如 pydantic_core._pydantic_core.ValidationError */
  errorClass?: string;
  /** 失败目标：文件路径或命令名（若可提取） */
  target?: string;
  /** 清洗后的可读摘要（≤200 字，乱码替换为 ?），用于 UI 与 LLM 输入 */
  summary: string;
  /** 原文是否含 U+FFFD（中文损坏）。为 true 不表示不可分类 */
  garbled: boolean;
}

/** 形如 `Command exited with code 127` 的退出码 —— 实测 252/349 条带此项 */
const EXIT_CODE_RE = /Command exited with code (-?\d+)/;

/** 以日志级别开头。方括号形式 `[OK]` 也要认：实测 4 条命中此形态却被误判 */
const LOG_PREFIX_RE = /^\s*\[?\s*(?:OK|WARN|WARNING|SUCCESS|DONE|INFO|完成|成功)\s*\]?[\s:：]/i;

/**
 * 出现即说明确实失败的关键信号。
 * 注意 `\berrors?\b` 单列：实测 "首末未通过：5 个 error，已终止渲染" 这类文本
 * 以 OK: 开头但确实是失败，若不拦会被误判成 not_an_error（曾误判 9 条）。
 */
const ERROR_HINT_RE =
  /Traceback \(most recent call last\)|command not found|is not recognized|No such file or directory|cannot access|Permission denied|EACCES|EPERM|\berrors?\b|未通过|失败|failed|终止|Exception|Error:/i;

const COMMAND_NOT_FOUND_RE =
  /command not found|is not recognized as an internal or external command|line \d+:\s*[^:\n]+:\s*not found/i;

/** UnicodeEncodeError 等既是异常也是编码问题 —— 编码优先，因为根因更具体 */
const ENCODING_RE =
  /Unicode(?:En|De)codeError|codec can't|'gbk'|\bgbk\b|utf-8.*codec|codec.*utf-8/i;

const TIMEOUT_RE = /timed? ?out|ETIMEDOUT|TimeoutError|超时/i;

const PERMISSION_RE = /EACCES|EPERM|Permission denied|PermissionError|权限不足/i;

const MISSING_PATH_RE =
  /No such file or directory|cannot access|cannot find the path|系统找不到指定的路径|FileNotFoundError/i;

const IO_ERROR_RE = /\bE(?:ISDIR|NOTDIR|NOSPC|IO|MFILE|BADF)\b|illegal operation on a directory/i;

/**
 * shell 语法错误 —— 直接指向「Agent 拼命令时引号/转义没处理对」，
 * 是行为可修复的问题，与环境故障必须分开（实测 14 条 unexpected EOF）。
 */
const SHELL_SYNTAX_RE =
  /unexpected EOF while looking for matching|syntax error near unexpected token|ambiguous redirect|unexpected end of file/i;

/**
 * 编辑工具定位失败 —— 这是 Agent 行为的直接证据（未先读取最新文件内容就改写），
 * 单独成类才有诊断价值，混进 unknown 会被淹没。
 * `Could not find edits[4]` 是另一种表述，实测 3 条曾漏判。
 */
const EDIT_MISMATCH_RE =
  /Could not find the exact text|Could not find edits?[\[ ]|The old text must match exactly|The oldText must match exactly|No changes made|replacement produced identical content|String to replace not found/i;

/**
 * JSON 不合法。不靠 Traceback 判定：实测 PPT 类 Agent 由脚本自己打印
 * 「版式 JSON 解析失败：Expecting property name enclosed in double quotes」，
 * 没有 Traceback，朴素规则会落到 exit_code，根因就丢了。
 */
const JSON_INVALID_RE =
  /Expecting property name enclosed in double quotes|Expecting ',' delimiter|Expecting value: line|Extra data: line|Unterminated string|JSON 解析失败|JSONDecodeError/i;

/** 入参越界：read 工具的 offset 超过文件行数是典型场景 */
const INVALID_ARGUMENT_RE = /offset \d+ is beyond end of file|out of range|invalid argument|索引越界/i;

const TRACEBACK_RE = /Traceback \(most recent call last\)/;

/**
 * 用户主动中止。实测 "Command aborted" 被 naive 判定成 critical 致命失败，
 * 实为用户按下停止 —— 归入故障会直接制造假告警，必须单独成类并降级。
 */
const INTERRUPTED_RE = /Command aborted|aborted by user|cancelled by user|Operation aborted|SIGINT|已中止|用户取消/i;

/** 异常类名：Traceback 内或 `XxxError: msg` 形式 */
const EXCEPTION_CLASS_RE = /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception))\s*:/;

/**
 * 目标提取：**引号包裹的完整路径优先**。
 * 曾经的 bug：`cannot access 'E:/x/y/': No such...` 被 `: ` 断句规则截成 "E"，
 * 导致 6 条不同路径合并成同一个 key。盘符里的冒号不能当分隔符。
 */
const TARGET_PATTERNS: RegExp[] = [
  // 1. 引号包裹的绝对路径（Windows 盘符或 POSIX 根）
  /['"]([A-Za-z]:[\\/][^'"]+|~?\/[^'"\n]+)['"]/,
  // 2. No such file or directory: 'xxx'
  /No such file or directory:\s*['"]?([^'"\n]+?)['"]?\s*$/im,
  // 3. cannot access xxx（无引号，靠行尾/冒号收束）
  /cannot access\s+([^'"\n]+?)\s*$/im,
  // 4. EACCES / EPERM 后面的路径
  /(?:EACCES|EPERM)[:,]\s*[^'"\n]*?['"]([^'"]+)['"]/i,
  /permission denied,?\s*[^'"\n]*?['"]([^'"]+)['"]/i,
  // 5. shell 报错里的命令名：/usr/bin/bash: line 1: gcc: command not found
  /line \d+:\s*([^:\n]+):\s*command not found/i,
];

/** 归一化：小写、数字折叠、去引号与空白，让同类失败的 key 稳定 */
function normalizeForKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[\\/]+/g, "/")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** 把 U+FFFD 连续段折叠成单个 ?，避免摘要满屏乱码方块 */
function cleanText(text: string): string {
  return text
    .replace(/\uFFFD{2,}/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 候选行的信息量打分。固定顺序取行会踩两个坑（实测）：
 * - 取首个关键词行 → 得到 `Environment variables loaded from .env`
 * - 取末个关键词行 → 得到 `Error:`（原文是 "Permission denied\nError:" 的拼接）
 * 因此按信息量排序而非按位置。
 */
function lineScore(line: string): number {
  let s = 0;
  // 含具体错误短语：最有价值
  if (
    /(denied|not found|no such file|cannot|codec|unexpected|illegal|invalid|timed? ?out|traceback|e(?:perm|acces|noent|isdir|notdir))/i.test(
      line,
    )
  ) {
    s += 3;
  }
  if (
    /permission denied|no such file or directory|command not found|codec can't|unexpected eof|operation not permitted/i.test(
      line,
    )
  ) {
    s += 2;
  }
  if (line.length >= 20) s += 1;
  // JSON 片段与悬空冒号几乎不含信息
  if (/^[{}\[\],"]/.test(line)) s -= 3;
  if (/[:：]\s*$/.test(line)) s -= 2;
  if (line.length < 6) s -= 2;
  // 纯退出码行信息量最低：它只在完全无其他线索时才该被选中
  if (/^command exited with code -?\d+$/i.test(line)) s -= 2;
  return s;
}

/**
 * 摘要取值策略：
 * - Traceback：末两行是「异常类: 消息」，信息量最大
 * - 其他：对所有行打分取最高分，同分取靠后（错误通常在输出末尾）
 * - 全为负分时取含退出码的行，最后退回首行
 */
function buildSummary(raw: string, isTraceback: boolean): string {
  if (isTraceback) {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    /**
     * 不能只取末行：pydantic 的 Traceback 末尾是
     * "For further information visit https://errors.pydantic.dev/..."，
     * 真正的信息在「异常类: N validation errors」及其后的字段明细。
     */
    const excIdx = lines.findIndex((l) => /^[A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception)\s*:/.test(l));
    if (excIdx >= 0) {
      return cleanText(lines.slice(excIdx, excIdx + 3).join(" ")).slice(0, 200);
    }
    const tail = lines.slice(-2).join(" ");
    if (tail) return cleanText(tail).slice(0, 200);
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let bestIdx = -1;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < lines.length; i++) {
    const sc = lineScore(lines[i]);
    // >= 让同分时保留靠后的行
    if (sc >= bestScore) {
      bestScore = sc;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestScore > 0) return cleanText(lines[bestIdx]).slice(0, 200);

  const exitLine = lines.find((l) => EXIT_CODE_RE.test(l));
  if (exitLine) {
    const idx = lines.indexOf(exitLine);
    const prev = idx > 0 ? lines[idx - 1] : "";
    return cleanText(`${prev} ${exitLine}`).slice(0, 200);
  }
  return cleanText(lines[0] ?? "").slice(0, 200);
}

/** 路径替换为 *，让「同一校验规则在不同文件上失败」能聚成一类 */
function stripPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:[\\/][^\s'"}]+/g, "*")
    .replace(/\/[\w.\-/]+/g, "*")
    .replace(/\*+/g, "*");
}

function extractTarget(text: string): string | undefined {
  for (const re of TARGET_PATTERNS) {
    const m = text.match(re);
    const v = m?.[1]?.trim();
    if (v && v.length > 0) return v.slice(0, 200);
  }
  return undefined;
}

/** 这些类型必须按目标区分：不同路径就是不同问题 */
const TARGET_SCOPED: ReadonlySet<ErrorSignatureKind> = new Set([
  "missing_path",
  "permission",
  "io_error",
  "command_not_found",
  "edit_mismatch",
]);

/**
 * 分类优先级（顺序即优先级，不可随意调整）：
 *   not_an_error > command_not_found > encoding > permission > missing_path
 *   > io_error > edit_mismatch > exception > timeout > exit_code > unknown
 *
 * 越靠前越具体：`FileNotFoundError: No such file` 判 missing_path 而非
 * exception，因为前者直接指向根因（路径写错），后者只说"有个异常"。
 * errorClass 无论最终 kind 是什么都会被提取，信息不丢失。
 */
export function signatureOf(input: {
  error: string | null | undefined;
  name?: string;
  status?: string;
}): ErrorSignature {
  const raw = (input.error ?? "").trim();
  const garbled = raw.includes("\uFFFD");
  const exitCodeMatch = raw.match(EXIT_CODE_RE);
  const exitCode = exitCodeMatch ? Number(exitCodeMatch[1]) : undefined;
  const isTraceback = TRACEBACK_RE.test(raw);
  const errorClass = raw.match(EXCEPTION_CLASS_RE)?.[1] ?? undefined;

  const base = { exitCode, errorClass, garbled };

  // 空错误：既不是失败信息，也不该算 not_an_error（那是"有文本但非错误"）
  if (!raw) {
    return { ...base, kind: "unknown", key: "unknown|empty", family: "unknown||", summary: "" };
  }

  if (LOG_PREFIX_RE.test(raw) && !ERROR_HINT_RE.test(raw)) {
    const s = buildSummary(raw, false);
    return {
      ...base,
      kind: "not_an_error",
      key: `not_an_error|${normalizeForKey(s)}`,
      family: `not_an_error|${normalizeForKey(stripPaths(s))}`,
      summary: s,
    };
  }

  let kind: ErrorSignatureKind;
  if (INTERRUPTED_RE.test(raw)) {
    kind = "interrupted";
  } else if (COMMAND_NOT_FOUND_RE.test(raw) || exitCode === 127) {
    kind = "command_not_found";
  } else if (SHELL_SYNTAX_RE.test(raw)) {
    kind = "shell_syntax";
  } else if (ENCODING_RE.test(raw) || /Unicode(?:En|De)codeError/.test(errorClass ?? "")) {
    kind = "encoding";
  } else if (PERMISSION_RE.test(raw)) {
    kind = "permission";
  } else if (MISSING_PATH_RE.test(raw)) {
    kind = "missing_path";
  } else if (IO_ERROR_RE.test(raw)) {
    kind = "io_error";
  } else if (EDIT_MISMATCH_RE.test(raw)) {
    kind = "edit_mismatch";
  } else if (JSON_INVALID_RE.test(raw)) {
    kind = "json_invalid";
  } else if (INVALID_ARGUMENT_RE.test(raw)) {
    kind = "invalid_argument";
  } else if (isTraceback || errorClass) {
    kind = "exception";
  } else if (TIMEOUT_RE.test(raw)) {
    kind = "timeout";
  } else if (exitCode !== undefined) {
    kind = "exit_code";
  } else {
    kind = "unknown";
  }

  const target = extractTarget(raw);
  const summary = buildSummary(raw, isTraceback);

  /**
   * key 的构成决定聚合粒度，两类诉求相反：
   * - 路径类（missing_path 等）：不同路径是不同问题，必须带 target
   * - 异常类：同一异常类 + 同一消息在不同文件上失败，是同一个根因，
   *   用 stripPaths 后的摘要做 key（否则 pydantic 的 42 条会被路径拆成 4 组）
   */
  let keySubject: string;
  if (TARGET_SCOPED.has(kind) && target) {
    keySubject = target;
  } else if (summary) {
    keySubject = kind === "exception" ? stripPaths(summary) : summary;
  } else if (exitCode !== undefined) {
    keySubject = `exit${exitCode}`;
  } else {
    keySubject = "unknown";
  }

  // family 不参与 target 区分：路径类问题在家族层面视为同一类，便于排行。
  // errorClass 同样不参与：实测 missing_path 因 FileNotFoundError 有无类名被拆成
  // 26 + 7 两条线，而它们是同一类问题（路径不存在）。
  const familySubject = TARGET_SCOPED.has(kind)
    ? ""
    : summary
      ? stripPaths(summary)
      : exitCode !== undefined
        ? `exit${exitCode}`
        : "unknown";

  const classPart = errorClass ? normalizeForKey(errorClass) : "";
  const familyClassPart = TARGET_SCOPED.has(kind) ? "" : classPart;

  return {
    ...base,
    kind,
    key: `${kind}|${classPart}|${normalizeForKey(keySubject)}`,
    family: `${kind}|${familyClassPart}|${normalizeForKey(familySubject)}`,
    target,
    summary,
  };
}

/** 工具名归一：edit_file / edit 视为同类，避免同一问题被拆成两条 */
export function normalizeToolName(name: string | undefined): string {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return "unknown";
  if (n === "edit_file" || n === "edit" || n === "write" || n === "write_file") return "edit";
  if (n === "read" || n === "read_file" || n === "cat") return "read";
  if (n === "bash" || n === "shell" || n === "run_command") return "shell";
  if (n === "grep" || n === "rg" || n === "search") return "search";
  return n;
}

/**
 * 错误类型的展示名。
 *
 * 放在引擎层而不是组件层，是因为「问题列表」与「运行异常分析面板」都要用同一套措辞，
 * 两处各写一份必然漂移（实测已经漂过一次：面板里叫「非零退出」，别处叫「退出码」）。
 */
export const ERROR_KIND_LABEL: Record<ErrorSignatureKind, string> = {
  not_an_error: "日志误写",
  command_not_found: "命令缺失",
  encoding: "编码不一致",
  exception: "运行异常",
  permission: "权限/占用",
  missing_path: "路径不存在",
  io_error: "文件类型错误",
  shell_syntax: "命令语法错误",
  edit_mismatch: "编辑定位失败",
  json_invalid: "JSON 不合法",
  invalid_argument: "入参越界",
  timeout: "超时",
  exit_code: "非零退出",
  interrupted: "用户中止",
  unknown: "未归类",
};
