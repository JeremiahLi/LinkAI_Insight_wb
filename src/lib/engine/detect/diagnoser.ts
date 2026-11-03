/**
 * L3 LLM 归因层：只处理 L2 规则判不了的少量样本。
 *
 * 分工（层名对应 src/lib/engine/diagnose/）：
 * - L0 特征：error-signature.ts（正则，确定性）
 * - L1 因果：cli 里组装 producers（产物 ↔ 生产者 span）
 * - L2 规则：diagnose/l2-rules.ts（确定性，能定的全定死）
 * - L3 本文件：只剩判不了的交模型
 * - L5 门禁：diagnose/l5-verify.ts（证据可寻 / 归因可修）
 *
 * 根因枚举的唯一来源是 diagnose/root-cause.ts —— 曾经在这里另存一份，
 * 结果是「报告措辞」和「校验层判据」两处漂移。
 */
import {
  ROOT_CAUSES,
  ROOT_CAUSE_HINT,
  ROOT_CAUSE_LABEL,
  SUB_TYPE_LABEL,
  rootCauseLabel,
  type RootCause,
  type SubType,
} from "../diagnose/root-cause";
import { attributeByRules, type RuleContext, type RuleVerdict } from "../diagnose/l2-rules";
import { verifyDiagnosis, type VerifyResult } from "../diagnose/l5-verify";

export { ROOT_CAUSE_LABEL, ROOT_CAUSE_HINT, SUB_TYPE_LABEL, rootCauseLabel, type RootCause, type SubType };
export { ROOT_CAUSES };

export interface DiagnosisInput {
  agentName: string;
  tool: string;
  /** 错误形态（error-signature 的 kind），作为参考不是答案 */
  errorKind: string;
  /** 错误形态的中文名 */
  errorKindLabel: string;
  /** 失败链结局：retried_failed / abandoned / fatal / isolated */
  outcome: string;
  attempts: number;
  /** 错误原文（已归一化的摘要 + 原始片段） */
  errorText: string;
  /** 失败 span 的入参 */
  spanInput: string;
  /** 失败 span 的输出（若有） */
  spanOutput: string;
  /** 会话最开始的用户诉求（任务背景）。续跑轮常只有「继续」「好」，缺了它模型看不出目标对不对 */
  taskIntent?: string;
  /** 该轮用户的诉求（该轮 user span 的内容） */
  roundIntent: string;
  /** 该轮之前出现过的工具名序列 */
  toolSequence: string;
  /** 前一个 span 的简述 */
  prevSpan: string;
  /** 后一个 span 的简述 */
  nextSpan: string;
  /** 该签名在库里的复发情况 */
  recurrence: string;
  /** 供 L2 规则层使用的确定性上下文（产物生产者、前序改写、约束文档读取等） */
  ruleContext?: Omit<RuleContext, "tool" | "errorText" | "spanInput" | "spanOutput" | "kind" | "errorClass">;
}

export interface Diagnosis {
  rootCause: RootCause;
  /** 二级细分：同一根因下修法互斥的情形（如 edit 的旧快照 vs 臆造） */
  subType?: SubType;
  /** 一句话根因叙述 */
  narrative: string;
  /** 必须来自给定材料的原句 */
  evidenceRefs: string[];
  /** 可执行的修复动作 */
  suggestion: string;
  /** 0-1 */
  confidence: number;
  /** 结论来自哪一层：规则层命中就不用调模型，成本与稳定性完全不同 */
  layer: "rules" | "llm";
  /** 真正该改的那个 span（可能不是失败的那个） */
  targetSpanId?: string;
  /**
   * 证据被裁剪过（原证据超时，砍半后重试成功）。
   * 必须透出到 UI/报告：这种结论的可信度低于完整证据，不能混在一起看。
   */
  degraded?: boolean;
  /** L5 门禁结果：reliable / low_confidence / rejected，以及违反项 */
  verify?: VerifyResult;
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 单次请求超时。小模型（如 4B）在 8K 上下文下可能跑 60s+，90s 会误杀 */
  timeoutMs?: number;
}

const MAX_INPUT_CHARS = 8000;

/**
 * 提示词里的类别说明**从 root-cause.ts 生成**，不另写一份。
 * 曾经两处各写一套，结果是「报告里叫指令不清、校验层按需求不清判」。
 *
 * 铁律 5-8 逐条对应 2026-11-02 人工标注暴露的错法：
 * 5 → 5 条「shell 入参合法却判入参错」；6 → 3 条「约束写在 SKILL.md 里却判需求不清」；
 * 7 → 2 条「字段名写错判成编造事实」；8 → 「改完会被覆盖」的无效建议。
 */
function buildSystemPrompt(): string {
  const keys = Object.keys(ROOT_CAUSE_HINT) as RootCause[];
  const list = keys.map((k) => `- ${k}（${ROOT_CAUSE_LABEL[k]}）：${ROOT_CAUSE_HINT[k]}`).join("\n");
  return `你是 Agent 运行时故障分析专家。给你一次失败的工具调用及其上下文，判断**根因类别**并给出可执行的修复建议。

只能使用下面 ${keys.length} 个类别之一（输出英文枚举值，不要自造）：
${list}

铁律：
1. evidenceRefs 里每一条，必须是**输入材料中能逐字找到的原句片段**。不许改写、不许总结、不许编造。找不到就少写几条。
2. 证据不足时仍选一个类别，但 confidence 给 0.3 以下——不要用高置信度掩盖不确定。
3. narrative 说清「为什么会错」，不要复述错误信息。
4. suggestion 要能落地：改哪个文件/字段/命令，或加什么校验。不要写"检查入参"这种空话。
5. **失败命令本身合法（能解析、引号成对、路径没写错）时，不得判 tool_arg_error**。那种情况下真正的毛病在别处——上游写出的产物、或运行环境，要往上游追。
6. 约束写在代码、schema 或 SKILL.md 里就**算已声明**。模型没遵守它，不是「需求不清」。判 requirement_ambiguity 必须能在轨迹里指出模型追问、要求确认或反复猜目标。
7. 字段名/结构写错不是 hallucination。hallucination 只用于「输出里的具体事实、路径、值在材料中根本找不到出处」。
8. 建议不要让人去改一个会被脚本每次重建的产物（如 pipeline 中间生成的 deck.json）——改完会被覆盖，等于没改。

只输出 JSON，不要 markdown 代码围栏：
{"rootCause":"...","subType":"（可空）","narrative":"...","evidenceRefs":["..."],"suggestion":"...","confidence":0.0}`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

function clip(s: string, n: number): string {
  const t = (s ?? "").trim();
  if (!t) return "（无）";
  return t.length > n ? `${t.slice(0, n)}\n…（截断，原长 ${t.length} 字符）` : t;
}

/** 按优先级裁剪总输入，保证 8K 内且保留最关键的证据 */
export function buildDiagnosisUserPrompt(input: DiagnosisInput): string {
  // 顺序即优先级：错误原文和入参最重要，上下文次之
  const parts: string[] = [
    `【Agent】${input.agentName}　【接口】${input.tool}`,
    `【会话起始任务】\n${clip(input.taskIntent ?? "", 700)}`,
    `【该轮用户诉求】\n${clip(input.roundIntent, 600)}`,
    `【该轮工具调用序列】\n${clip(input.toolSequence, 400)}`,
    `【失败调用入参】\n${clip(input.spanInput, 2000)}`,
    `【错误原文】\n${clip(input.errorText, 2400)}`,
    `【失败调用输出】\n${clip(input.spanOutput, 800)}`,
    `【前一个 span】\n${clip(input.prevSpan, 500)}`,
    `【后一个 span】\n${clip(input.nextSpan, 500)}`,
    `【失败结局】${input.outcome}，尝试 ${input.attempts} 次`,
    `【规则层已排除的粗分类（仅供参考，不要被它带偏）】${input.errorKindLabel}（${input.errorKind}）`,
  ];
  if (input.recurrence) parts.push(`【复发情况】${input.recurrence}`);

  let out = "";
  for (const p of parts) {
    if (out.length + p.length > MAX_INPUT_CHARS) break;
    out += `${p}\n\n`;
  }
  return out.trim();
}

/** 剥掉模型可能加的 ```json 围栏 */
function stripFence(text: string): string {
  const t = text.trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
}

export function parseDiagnosis(raw: string): Diagnosis | null {
  const body = stripFence(raw);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rootCause = String(obj.rootCause ?? "").trim();
  if (!ROOT_CAUSES.has(rootCause)) return null;

  const evidenceRefs = Array.isArray(obj.evidenceRefs)
    ? obj.evidenceRefs.map((x) => String(x).trim()).filter(Boolean).slice(0, 5)
    : [];
  const confRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0;
  const subRaw = String(obj.subType ?? "").trim();

  return {
    rootCause: rootCause as RootCause,
    subType: subRaw ? (subRaw as SubType) : undefined,
    narrative: String(obj.narrative ?? "").trim(),
    evidenceRefs,
    suggestion: String(obj.suggestion ?? "").trim(),
    confidence,
    layer: "llm",
  };
}

/** OpenAI 兼容的 chat/completions 调用（不依赖项目里的 judge-llm，便于 CLI 独立运行） */
async function callChat(cfg: LlmConfig, system: string, user: string, temperature: number): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    // 超时可配：默认 120s。CLI 会跑几十条，不能因为一次挂起卡死整批
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
    body: JSON.stringify({
      model: cfg.model,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * 单轮尝试：正常温度一次，解析失败降温度重试一次。
 * 网络/超时错误直接抛出（重试同样的输入只会再超时一次）。
 */
async function attempt(input: DiagnosisInput, cfg: LlmConfig): Promise<Diagnosis> {
  const user = buildDiagnosisUserPrompt(input);
  const first = await callChat(cfg, SYSTEM_PROMPT, user, 0.2);
  const parsed = parseDiagnosis(first);
  if (parsed) return parsed;

  const retry = await callChat(cfg, SYSTEM_PROMPT, user, 0);
  const parsedRetry = parseDiagnosis(retry);
  if (parsedRetry) return parsedRetry;
  throw new Error(`无法解析模型输出：${stripFence(retry || first).slice(0, 200)}`);
}

function isTimeoutLike(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /timeout|timed out|abort/i.test(msg);
}

function cut(s: string | undefined, n: number): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n) : t;
}

/**
 * 调模型（L3）。只在 L2 规则判不了时进入。
 *
 * 失败路径：
 * 1. 解析不出 JSON → 降温度重试（在 attempt 内）。
 * 2. 超时 → 证据砍半再试一次，成功则标记 degraded。
 *    超时基本是「证据太长、模型解码慢」，不是网络抖动；原样重试只会再超时一次。
 *    砍证据会掉信息，所以必须标记 degraded，不能和完整证据的结论等同看待。
 * 3. 其它错误（401/402/5xx）直接抛，由调用方记录，不静默吞掉。
 */
export async function diagnose(input: DiagnosisInput, cfg: LlmConfig): Promise<Diagnosis> {
  try {
    return await attempt(input, cfg);
  } catch (e) {
    if (!isTimeoutLike(e)) throw e;
    const trimmed: DiagnosisInput = {
      ...input,
      spanInput: cut(input.spanInput, 800),
      errorText: cut(input.errorText, 1200),
      spanOutput: cut(input.spanOutput, 400),
      toolSequence: cut(input.toolSequence, 240),
      prevSpan: cut(input.prevSpan, 200),
      nextSpan: cut(input.nextSpan, 200),
      taskIntent: cut(input.taskIntent, 300),
      roundIntent: cut(input.roundIntent, 300),
    };
    const d = await attempt(trimmed, cfg);
    return { ...d, degraded: true };
  }
}

/**
 * 诊断一条失败链：**先规则，后模型**。
 *
 * 分层理由：规则层判定的每一条都是确定性复现的，成本为零、不会漂移；
 * 只有规则判不了的才值得调用模型。层号会写进结果，便于按层统计准确率——
 * 「哪一层不可靠」比「整体不太准」有用得多。
 *
 * L5 门禁在返回前必过：证据逐字可寻、归因对象可修，任一不过就压低置信度并记录违反项。
 */
export async function diagnoseCase(
  input: DiagnosisInput,
  cfg: LlmConfig,
  opts: { materials?: string } = {},
): Promise<Diagnosis> {
  const rule = attributeByRules({
    tool: input.tool,
    errorText: input.errorText,
    spanInput: input.spanInput,
    spanOutput: input.spanOutput,
    kind: input.errorKind,
    ...input.ruleContext,
  });

  let d: Diagnosis;
  if (rule) {
    d = {
      rootCause: rule.rootCause,
      subType: rule.subType,
      // 规则层的「叙述」就是判据本身：每条都能回头核对，不是自然语言断言
      narrative: rule.reasons.join("；"),
      evidenceRefs: rule.reasons,
      suggestion: rule.advice ?? "",
      confidence: rule.confidence,
      layer: "rules",
      targetSpanId: rule.targetSpanId,
    };
    const note = rule.targetNote ?? rule.adviceTrap;
    if (note) d.narrative = `${d.narrative}${d.narrative ? "；" : ""}${note}`;
  } else {
    d = await diagnose(input, cfg);
  }

  d.verify = verifyDiagnosis({
    rootCause: d.rootCause,
    evidenceRefs: d.evidenceRefs,
    confidence: d.confidence,
    suggestion: d.suggestion,
    materials: opts.materials ?? buildDiagnosisUserPrompt(input),
    spanInput: d.layer === "llm" ? input.spanInput : undefined,
    tool: d.layer === "llm" ? input.tool : undefined,
    // 规则层不校证据原文：它的依据是正则命中与判据复现，本就不该拿"引文"标准衡量
    skipEvidence: d.layer === "rules",
  });
  d.confidence = d.verify.confidence;
  return d;
}
