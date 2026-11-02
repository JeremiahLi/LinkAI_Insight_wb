/**
 * 根因诊断（Diagnoser）：把「错误形态」升级成「为什么错」。
 *
 * 与 remediation.ts 的分工：
 * - remediation 是**规则版**：按错误 kind 匹配预设文案（edit_mismatch → "编辑定位失败，检查 oldText"）。
 *   同一个 kind 无论上下文都给同一套话，这是它的天花板。
 * - 本模块是**语义版**：把「失败的入参 + 错误原文 + 前后 span + 该轮用户诉求 + 工具序列」
 *   交给 LLM，让它判断属于哪一类根因、依据是哪句原文、该怎么改。
 *
 * 三条硬约束（不做就会变成一个自信的胡说源）：
 *   1. 输出必须落在**封闭枚举**内，否则无法聚合「哪类根因占比最高」。
 *   2. evidenceRefs 必须是**给定材料里的原句**，不许自造；标注时逐条核对。
 *   3. 只跑 actionable 链（已排除重试自愈/用户中止），全库量级是几十条，成本可忽略。
 *
 * 本文件不依赖 prisma，配置由调用方注入 —— 这样才能被 CLI 直接 require（见 detect:build）。
 */

export type RootCause =
  | "prompt_ambiguity"
  | "tool_arg_error"
  | "tool_env_error"
  | "context_missing"
  | "context_overflow"
  | "loop"
  | "hallucination"
  | "downstream_error";

export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  prompt_ambiguity: "指令不清",
  tool_arg_error: "入参构造错",
  tool_env_error: "环境/依赖/权限",
  context_missing: "缺必要信息就作答",
  context_overflow: "上下文截断/遗忘",
  loop: "重复无效调用",
  hallucination: "编造事实或路径",
  downstream_error: "外部服务错误",
};

export const ROOT_CAUSE_HINT: Record<RootCause, string> = {
  prompt_ambiguity: "指令或约束表述不清，模型反复澄清或猜错目标",
  tool_arg_error: "工具入参构造错误：路径写错、引号转义失败、参数类型/字段错",
  tool_env_error: "环境、依赖、权限问题：EACCES、command not found、网络/超时",
  context_missing: "没读必要信息就下结论（轨迹里没有相关读取，输出却含具体断言）",
  context_overflow: "上下文被截断或遗忘，早期约束在后轮被违反",
  loop: "同参数重复调用且无进展（≥3 次）",
  hallucination: "编造不存在的事实、路径、接口或字段",
  downstream_error: "外部服务返回错误（第三方 API 4xx/5xx、模型服务异常）",
};

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
}

export interface Diagnosis {
  rootCause: RootCause;
  /** 一句话根因叙述 */
  narrative: string;
  /** 必须来自给定材料的原句 */
  evidenceRefs: string[];
  /** 可执行的修复动作 */
  suggestion: string;
  /** 0-1 */
  confidence: number;
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const MAX_INPUT_CHARS = 8000;

const SYSTEM_PROMPT = `你是 Agent 运行时故障分析专家。给你一次失败的工具调用及其上下文，你要判断**根因类别**并给出可执行的修复建议。

只能使用下面 8 个根因类别之一（输出英文枚举值，不要自造）：
- prompt_ambiguity：指令或约束表述不清，模型反复澄清、要求确认、猜错目标
- tool_arg_error：工具入参构造错误（路径拼错、引号转义失败、参数类型/字段名错）
- tool_env_error：环境/依赖/权限（EACCES、command not found、模块缺失、网络超时）
- context_missing：未读取必要信息就作答（轨迹里没有相关读取/检索，输出却含具体断言）
- context_overflow：上下文截断或遗忘（早期约束在后轮被违反、同一信息反复重读）
- loop：同参数重复调用且无进展（≥3 次）
- hallucination：编造不存在的事实、文件路径、接口或字段
- downstream_error：外部服务返回错误（第三方 API 4xx/5xx、模型服务异常）

铁律：
1. evidenceRefs 里的每一条，必须是**输入材料中能逐字找到的原句片段**。不许改写、不许总结、不许编造。找不到就少写几条。
2. 如果证据不足以判断，仍然选一个类别，但 confidence 给 0.3 以下——不要用高置信度掩盖不确定。
3. narrative 说清「为什么会错」，不要复述错误信息。
4. suggestion 要能落地：改哪个文件/字段/命令，或加什么校验。不要写"检查入参"这种空话。

只输出 JSON，不要 markdown 代码围栏：
{"rootCause":"...","narrative":"...","evidenceRefs":["..."],"suggestion":"...","confidence":0.0}`;

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

const ROOT_CAUSES = new Set<string>(Object.keys(ROOT_CAUSE_LABEL));

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

  return {
    rootCause: rootCause as RootCause,
    narrative: String(obj.narrative ?? "").trim(),
    evidenceRefs,
    suggestion: String(obj.suggestion ?? "").trim(),
    confidence,
  };
}

/** OpenAI 兼容的 chat/completions 调用（不依赖项目里的 judge-llm，便于 CLI 独立运行） */
async function callChat(cfg: LlmConfig, system: string, user: string, temperature: number): Promise<string> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    // 单条诊断 90s 超时：CLI 会跑几十条，不能因为一次挂起卡死整批
    signal: AbortSignal.timeout(90_000),
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
 * 诊断一条失败链。
 * 解析失败会重试一次（温度降为 0），仍失败则抛错由调用方记录，不静默吞掉。
 */
export async function diagnose(input: DiagnosisInput, cfg: LlmConfig): Promise<Diagnosis> {
  const user = buildDiagnosisUserPrompt(input);
  const first = await callChat(cfg, SYSTEM_PROMPT, user, 0.2);
  const parsed = parseDiagnosis(first);
  if (parsed) return parsed;

  const retry = await callChat(cfg, SYSTEM_PROMPT, user, 0);
  const parsedRetry = parseDiagnosis(retry);
  if (parsedRetry) return parsedRetry;
  throw new Error(`无法解析模型输出：${stripFence(retry || first).slice(0, 200)}`);
}

/** 给报告用：把根因枚举转中文标签 */
export function rootCauseLabel(rc: string): string {
  return ROOT_CAUSE_LABEL[rc as RootCause] ?? rc;
}
