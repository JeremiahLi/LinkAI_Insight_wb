/**
 * L2 规则归因：能确定性判定的，一律不交给 LLM。
 *
 * 设计原则（来自 2026-11-02 人工标注的实证）：
 * 标注里 10 条「半对/错」中有 5 条是**归因对象错位**——失败 span 是 `shell`
 * （`python validate_stage2.py a.json b.json`），入参完全合法，却被判成「入参构造错」。
 * 真正要改的是上游写 a.json 的那一步。这种事从文本里一眼能看出来，根本不该问模型。
 *
 * 本模块是纯函数：无 prisma、无网络、无随机性。同样的输入永远给同样的输出，
 * 每条判据都写进 reasons[]，人可以逐条核对，而不是接受一句自然语言断言。
 */
import type { ErrorSignatureKind } from "../detect/error-signature";
import type { RootCause, SubType } from "./root-cause";

export interface ProducerRef {
  spanId: string;
  tool: string;
  /** 被写入的产物路径 */
  path: string;
  how: "write" | "edit" | "script";
}

export interface RuleContext {
  tool: string;
  errorText: string;
  spanInput: string;
  spanOutput?: string;
  /** error-signature 的 kind，作为粗分类参考 */
  kind: ErrorSignatureKind | string;
  errorClass?: string;
  /** 失败命令引用、且在本会话前序被写过的产物 → 生产者 */
  producers?: ProducerRef[];
  /** 失败点之前是否动过同一目标文件（write/edit/bash 改写） */
  touchedTargetBefore?: boolean;
  /** 会话内是否读过约束文档（SKILL.md / schema 定义 / 校验脚本） */
  readConstraintDoc?: boolean;
  /** 失败前同工具同参数的成功调用次数（判 loop 用） */
  repeatCount?: number;
}

export interface RuleVerdict {
  rootCause: RootCause;
  confidence: number;
  subType?: SubType;
  /** 确定性依据，每条都可在原始材料里核对 */
  reasons: string[];
  /** 真正该改的那个 span（可能与失败的 span 不同） */
  targetSpanId?: string;
  /** 对归因对象的说明，报告里直接展示 */
  targetNote?: string;
  advice?: string;
  /** 若本条结论会诱使人去改一个注定被覆盖的文件，在这里写明 */
  adviceTrap?: string;
}

/* ------------------------------------------------------------------ */
/* 判据正则：全部来自标注里出现过的真实错误文本                          */
/* ------------------------------------------------------------------ */

/** pydantic / jsonschema 的强特征词。弱特征（Field required 等）不算，避免误判 */
const SCHEMA_STRONG_RE =
  /\b\d+ validation errors? for\b|ValidationError|string_too_(?:long|short)|union_tag_(?:not_found|invalid)|enum_tag|extra_forbidden|model_attributes_type/i;

/** heredoc 没写完 → 命令文本本身不完整，比编码问题更致命 */
const HEREDOC_UNCLOSED_RE =
  /here-document at line \d+ delimited by end-of-file|warning: here-document|unexpected EOF while looking for matching/i;

/** 长驻进程：给多长 timeout 都会被切断，正解是后台起 + 探活 */
const LONG_RUNNING_RE =
  /\b(?:npm run dev|npm run start|pnpm dev|pnpm start|yarn dev|next dev|vite|webpack serve|http-server|uvicorn|flask run|nodemon|serve -s|python -m http\.server)\b|--watch\b/i;

const ATTRIBUTE_ERROR_RE = /AttributeError:\s*'?(\w+)'?\s+object has no attribute\s+'?(\w+)'?/i;

/** 两套 shell 的路径语义不一致：bash 的 /tmp 与 Python 的 C:\tmp 不是同一处 */
const POSIX_TMP_RE = /(?:^|[\s'"=<])\/tmp\/[\w.\-/]*/;

const DOWNSTREAM_RE = /\b(?:50[0234]|429)\b|ECONNRESET|ETIMEDOUT|socket hang up|Connection reset by peer/i;

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

/** 从 span 入参里取命令行（shell 类工具） */
export function commandOf(spanInput: string): string | null {
  try {
    const o = JSON.parse(spanInput) as Record<string, unknown>;
    const v = o.command ?? o.cmd ?? o.script;
    return typeof v === "string" ? v : null;
  } catch {
    // 入参被截断或本身不是 JSON：退化为取首个长字符串，仅用于正则匹配
    const m = spanInput.match(/"command"\s*:\s*"((?:[^"\\]|\\.){10,})"/);
    return m ? m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : null;
  }
}

/**
 * 判定「这个入参本身有没有毛病」。
 *
 * 这是把「入参构造错」这个标签钉死的关键：入参合法时不得归此类，
 * 否则修的人会去改一条本来正常的命令，而真正的问题在上游。
 */
export function inputLooksValid(spanInput: string, tool: string): { valid: boolean; why: string } {
  const cmd = commandOf(spanInput);
  if (cmd === null) {
    // 非 shell 工具：JSON 能解析就算合法
    try {
      JSON.parse(spanInput);
      return { valid: true, why: `入参可解析为 JSON（${tool}）` };
    } catch {
      return { valid: false, why: "入参不是合法 JSON，可能被截断" };
    }
  }
  if (!cmd.trim()) return { valid: false, why: "命令为空" };

  // 引号成对性：仅统计未被转义的双引号
  const quotes = (cmd.match(/(?<!\\)"/g) ?? []).length;
  if (quotes % 2 !== 0) return { valid: false, why: `命令中有 ${quotes} 个未闭合的双引号` };

  // heredoc 必须有对应结束标识
  const hd = cmd.match(/<<-?\s*['"]?([A-Za-z_]\w*)/);
  if (hd) {
    const tag = hd[1];
    const closed = new RegExp(`^\\s*${tag}\\s*$`, "m").test(cmd);
    if (!closed) return { valid: false, why: `heredoc 声明了 <<${tag} 但没有对应的结束行` };
  }
  return { valid: true, why: "命令可解析、引号成对、无未闭合 heredoc" };
}

/* ------------------------------------------------------------------ */
/* 规则表                                                              */
/* ------------------------------------------------------------------ */

/**
 * 归因。
 * 返回 null 表示「规则层判不了」——交给 L3 的 LLM，并明确记下判不了的原因，
 * 这样准确率可以按层统计，而不是笼统地说「模型不准」。
 */
export function attributeByRules(ctx: RuleContext): RuleVerdict | null {
  const err = ctx.errorText ?? "";
  const cmd = commandOf(ctx.spanInput) ?? "";

  // R1 heredoc 未闭合：命令文本本身没写完，编码/环境都不是主因。
  // 必须先于编码判断——脚本被截断时，即使编码问题同时存在，修好编码也跑不通。
  if (HEREDOC_UNCLOSED_RE.test(err)) {
    return {
      rootCause: "input_truncation",
      confidence: 0.88,
      reasons: [
        "错误文本含「here-document ... delimited by end-of-file」：命令字符串缺少结束标识",
        `入参合法性检查：${inputLooksValid(ctx.spanInput, ctx.tool).why}`,
      ],
      advice:
        "不要用长 heredoc 传脚本：改为先 write 成临时 .py/.sh 文件再执行；若必须内联，把结尾标识单独放一行且前面不留空格。",
    };
  }

  // R2 编码损坏：**只认强证据**。
  // 踩过的坑：一开始用「文本含 U+FFFD」直接定编码，结果 23 条里 14 条被判成编码损坏——
  // 因为本项目中文输出普遍被采集端按错误编码写进 error，乱码到处都是，它只是背景噪声。
  // 真正的判据是「编码异常本身导致了失败」：
  //   (a) 异常类就是 UnicodeDecodeError/UnicodeEncodeError，或签名已判 encoding；
  //   (b) schema 校验失败且被校验的值里有乱码——乱码会改变字符长度，正是长度越界的成因。
  const strongEncoding =
    ctx.kind === "encoding" || /Unicode(?:En|De)codeError/.test(ctx.errorClass ?? "");
  const schemaHit = SCHEMA_STRONG_RE.test(err);

  if (strongEncoding) {
    return {
      rootCause: "encoding_corruption",
      confidence: 0.88,
      reasons: [
        `编码异常本身即为失败原因（${ctx.errorClass ?? ctx.kind}）`,
        "判断要点：写端与读端编码不一致时，任何基于字符长度的校验都会连带失败",
      ],
      advice:
        "写端与读端显式统一编码：Python 一律 open(..., encoding='utf-8')，重定向输出用 PYTHONIOENCODING=utf-8；不要依赖 Windows 默认 cp936。",
    };
  }

  if (schemaHit && garbledCountsAsCause(err)) {
    return {
      rootCause: "encoding_corruption",
      confidence: 0.82,
      subType: "upstream_producer",
      reasons: [
        "被校验的字段值里含替换字符 U+FFFD：文本在写入或读取时已按错误编码解码",
        `乱码改变了字符计数，进而触发长度类校验失败（${firstMatch(err, SCHEMA_STRONG_RE)}）`,
        "若只按「截断/补长」修，会把乱码文本继续带进下游",
      ],
      targetSpanId: ctx.producers?.[0]?.spanId,
      advice:
        "先修编码链路再谈内容：生成端写文件时显式 encoding='utf-8'，读取端同样指定；修好后重新生成产物，不要在下游手工修补乱码字段。",
    };
  }

  // R3 schema 违约：产物不符合下游契约。最高频，且与「需求不清」是完全不同的事
  if (schemaHit) {
    const reasons = [
      `错误文本命中 schema 校验特征：${firstMatch(err, SCHEMA_STRONG_RE)}`,
      ctx.readConstraintDoc
        ? "本会话已读过约束文档/校验脚本，说明约束对模型可见，违反它属生成端未遵守"
        : "约束由下游校验器强制（非用户口头要求）",
    ];
    return {
      rootCause: "schema_violation",
      confidence: ctx.readConstraintDoc ? 0.92 : 0.85,
      subType: ctx.producers?.length ? "upstream_producer" : undefined,
      reasons,
      targetSpanId: ctx.producers?.[0]?.spanId,
      targetNote: ctx.producers?.length
        ? `产物 ${ctx.producers[0].path} 由上游 ${ctx.producers[0].tool} 写入（span ${ctx.producers[0].spanId.slice(0, 8)}），要改的是那一步，不是失败的这个校验命令`
        : undefined,
      advice:
        "在生成端按 schema 逐字段构造（字段名、必填、长度上限），并在 merge/写入前先跑一次校验器自检，把错误挡在生成环节。",
    };
  }

  // R3b JSON 不合法：产物是写出来的。命令本身合法（json 解析器只负责读），
  // 责任在生成 JSON 的那一步——有生产者就直接指过去，没有也要标明是序列化环节。
  if (
    ctx.kind === "json_invalid" ||
    /Expecting property name enclosed in double quotes|Expecting ',' delimiter|Expecting value|JSON 解析失败/i.test(err)
  ) {
    return {
      rootCause: "schema_violation",
      confidence: ctx.producers?.length ? 0.88 : 0.78,
      subType: ctx.producers?.length ? "upstream_producer" : undefined,
      reasons: [
        `JSON 解析器报语法错误：${firstMatch(err, /Expecting[^\n]{0,50}|JSON 解析失败[^\n]{0,30}/)}`,
        ctx.producers?.length
          ? `该文件由上游 ${ctx.producers[0].tool} 写入（span ${ctx.producers[0].spanId.slice(0, 8)}）`
          : "失败命令只负责读取校验，写这个文件的是生成环节",
      ],
      targetSpanId: ctx.producers?.[0]?.spanId,
      targetNote: ctx.producers?.length
        ? `要改的是写 ${ctx.producers[0].path} 的那一步，不是这条校验命令`
        : undefined,
      advice:
        "不要手工拼接 JSON：用 json.dumps/dump 生成，并在写入后立即用 json.load 自检一遍；手写时重点查缺逗号、多尾逗号、字符串内未转义的引号与换行。",
    };
  }

  // R3c YAML 结构错误：与 JSON 同理，是产物不符合格式契约
  if (/ScannerError|ParserError|mapping values are not allowed|expected <block end>|could not find expected/i.test(err)) {
    return {
      rootCause: "schema_violation",
      confidence: 0.85,
      subType: ctx.producers?.length ? "upstream_producer" : undefined,
      reasons: [
        "YAML 解析器报结构错误（缩进/裸标量/冒号后缺值），属产物格式不符合契约",
        "关键点：这类错误与「背景字段缺 gradient」之类的语义约束是两回事，后者要靠校验器逐条闭环",
      ],
      targetSpanId: ctx.producers?.[0]?.spanId,
      advice:
        "生成 YAML 后用 yaml.safe_load 自检；块映射里不要出现裸标量行，冒号后必须有值或换行缩进。",
    };
  }

  // R3d Python 语法错误但指向全角标点：写入脚本时把中文引号带进去了，属入参构造错
  if (/SyntaxError/.test(err) && /invalid character|U\+20(?:1[0-9A-F]|22|26|13|14)/i.test(err)) {
    return {
      rootCause: "tool_arg_error",
      confidence: 0.9,
      reasons: [
        `语法错误指认出非法字符：${firstMatch(err, /invalid character[^\n]{0,40}/i)}`,
        "U+201C/U+201D 是中文弯引号，说明写入脚本时把排版符号当成了代码引号",
      ],
      advice:
        "把中文弯引号替换为 ASCII 引号；脚本写入后先跑 python -m py_compile 自检再执行，这类错误能在执行前 100% 拦住。",
    };
  }

  // R4 长驻进程被超时切断：提高 timeout 是错的方向，dev server 永不退出
  if (ctx.kind === "timeout" && LONG_RUNNING_RE.test(cmd)) {
    return {
      rootCause: "tool_arg_error",
      confidence: 0.9,
      subType: "long_running_timeout",
      reasons: [
        `命令是长驻服务：${firstMatch(cmd, LONG_RUNNING_RE)}`,
        "服务已正常启动（输出含 Ready/listening 之类），失败点是「永不退出被 timeout 切断」，不是启动失败",
      ],
      advice:
        "改为后台启动（nohup/start /b 或 &）并把日志重定向到文件，再用轮询探活（curl 健康检查）确认就绪；不要靠提高 timeout 解决。",
      adviceTrap: "提高 timeout 只会把挂起推后几十秒，进程依然不会退出。",
    };
  }

  // R5 空编辑：newText 与 oldText 完全相同，属结构性无效调用
  if (ctx.kind === "edit_mismatch") {
    const noop = detectNoopEdit(ctx.spanInput);
    if (noop) {
      return {
        rootCause: "tool_arg_error",
        confidence: 0.92,
        subType: "noop_edit",
        reasons: ["edit 入参中 oldText 与 newText 完全相同：这次调用本身不产生任何变更"],
        advice:
          "提交编辑前先比对新旧文本是否相同；若相同说明该修改已生效过，应先 read 目标位置确认当前内容再决定是否还要改。",
      };
    }
    // R6 edit 定位失败要分成两种，修法完全相反
    if (ctx.touchedTargetBefore) {
      return {
        rootCause: "tool_arg_error",
        confidence: 0.82,
        subType: "stale_snapshot",
        reasons: [
          "edit 报「找不到精确文本」，而失败点之前本会话已改写过同一目标文件",
          "即 oldText 取自旧快照，文件在两次读写之间已发生变化",
        ],
        advice:
          "edit 前强制 read 一次目标区间，用刚读到的文本作为 oldText；跨越多次写入的长流程里，宁可整体 write 覆盖也不要凭记忆构造 oldText。",
      };
    }
    return {
      rootCause: "tool_arg_error",
      confidence: 0.75,
      subType: "phantom_text",
      reasons: [
        "edit 报「找不到精确文本」，且失败点之前本会话没有改写过该文件",
        "说明 oldText 描述的内容在文件里从未存在（凭印象构造）",
      ],
      advice:
        "先 read 目标文件确认实际内容（含缩进、行尾、转义），再构造 oldText；不要基于对话记忆推测文件内容。",
    };
  }

  // R7 代码层的类型假设错误：`'list' object has no attribute 'get'` 这类完全可判
  const attr = err.match(ATTRIBUTE_ERROR_RE);
  if (attr) {
    return {
      rootCause: "tool_arg_error",
      confidence: 0.9,
      reasons: [
        `异常明确：'${attr[1]}' 类型对象没有属性 '${attr[2]}'`,
        "说明调用方对该数据结构的类型假设与真实数据不符",
      ],
      advice: `在取值前校验类型（isinstance/断言），或让上游保证返回 ${attr[1] === "list" ? "dict" : "预期类型"}。`,
    };
  }

  // R8 入参越界
  if (ctx.kind === "invalid_argument") {
    return {
      rootCause: "tool_arg_error",
      confidence: 0.85,
      reasons: ["入参数值越界（offset/索引超过实际范围），工具按契约拒绝"],
      advice: "读取前先确认目标行数/长度；更好的做法是让工具侧对越界做 clamp 而不是直接报错。",
    };
  }

  // R9 命令不存在 → 环境
  if (ctx.kind === "command_not_found" || /command not found|不是内部或外部命令/i.test(err)) {
    return {
      rootCause: "tool_env_error",
      confidence: 0.9,
      reasons: ["目标可执行文件不在 PATH 中（exit 127 / command not found）"],
      advice: "先探测可执行文件是否存在（which/where），再决定安装或改用等价命令。",
    };
  }

  // R10 路径语义不一致：同一个 /tmp 在两套 shell 里指向不同位置
  if (ctx.kind === "missing_path" && POSIX_TMP_RE.test(cmd)) {
    return {
      rootCause: "tool_env_error",
      confidence: 0.7,
      subType: "path_semantics_mismatch",
      reasons: [
        "命令引用了 /tmp 下的路径",
        "在 Windows 上 bash(MSYS) 的 /tmp 映射到 %TEMP%，而 Python 的 open('/tmp/...') 解析为 C:\\tmp —— 两者不是同一位置",
      ],
      advice: "跨语言传文件时用同一个显式绝对路径（如项目内 work/ 目录），不要用 /tmp 这类平台相关路径。",
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* 辅助                                                                */
/* ------------------------------------------------------------------ */

function firstMatch(text: string, re: RegExp): string {
  const m = text.match(re);
  return m ? m[0].slice(0, 60) : "";
}

/**
 * 抽出错误文本里「出问题的那些值」。
 * pydantic 的格式形如 `input_value='pi-ai �� pi-agent-core'`，
 * 这是判断「乱码是不是失败原因」的唯一可靠入口。
 */
function inputValuesOf(text: string): string[] {
  return [...text.matchAll(/input_value=(?:b?['"])?([^\n]*)/g)].map((m) => m[1]);
}

/** 数量类约束：TOC 超过 6 项这类，跟字符编码毫无关系 */
const COUNT_LIKE_RE =
  /too many items|list should have at most|list_length|at most \d+ items|should have at most \d+ items|should have at least \d+ items/i;
/** 字符长度类约束：乱码会改变字符计数，才可能是编码问题 */
const CHAR_LEN_RE = /string_too_(?:long|short)|at (?:most|least) \d+ characters?/i;

/**
 * 乱码是否**足以解释**这次 schema 失败。
 *
 * 这是本模块调得最细的一条判据，因为过宽会毁掉整个分类：
 * - 过宽版（错误文本含 U+FFFD 就算编码）→ 23 条里 14 条被判成编码损坏，
 *   因为本项目中文输出普遍被按错误编码写进 error，乱码是背景噪声。
 * - 只用 input_value 里是否有 U+FFFD → 仍有 4 条误判：数量超限（7 项 > 6）
 *   与乱码无关，纯粹是内容多。
 *
 * 所以要求同时满足三件事：
 * 1. 约束类型是**字符长度**（数量类约束直接排除）；
 * 2. 出问题的值里 U+FFFD 成段出现（≥2 个），单个替换字符可能只是孤立的坏字符；
 * 3. 错误文本确实带出了被校验的值（否则无从判断）。
 */
function garbledCountsAsCause(text: string): boolean {
  if (COUNT_LIKE_RE.test(text)) return false;
  if (!CHAR_LEN_RE.test(text)) return false;
  const values = inputValuesOf(text).join("\n");
  if (!values) return false;
  const runs = values.match(/\uFFFD{2,}/g) ?? [];
  return runs.length > 0;
}

/** 判断 edit 是否为空编辑：oldText 与 newText 相同 */
function detectNoopEdit(spanInput: string): boolean {
  try {
    const o = JSON.parse(spanInput) as Record<string, unknown>;
    const edits = Array.isArray(o.edits) ? (o.edits as Record<string, unknown>[]) : [o];
    return edits.some((e) => {
      const oldText = e.oldText ?? e.old_text ?? e.oldString;
      const newText = e.newText ?? e.new_text ?? e.newString;
      return typeof oldText === "string" && oldText.length > 0 && oldText === newText;
    });
  } catch {
    return false;
  }
}
