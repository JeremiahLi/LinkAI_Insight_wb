/**
 * L5 校验门禁：**最后一道确定性检查**，挡在结论到达使用者之前。
 *
 * 为什么必须有这一层：LLM 的结论只要有一条编造的证据，整份报告就失去可信度，
 * 而人没有精力逐条核对。凡是能机器验证的，就不能靠人信任。
 *
 * 三道检查，全部确定性：
 * 1. 枚举合法 —— 输出必须落在 root-cause.ts 定义的集合内（解析层已拦，这里二次确认）。
 * 2. 证据可寻 —— 每条 evidenceRef 必须能在「当时给模型的材料」里逐字找到。
 *    找不到的不是「表述不同」，是编造。
 * 3. 归因可修 —— 标签必须指向一个真能改的东西。
 *    最典型的反例：失败的是合法命令 `python validate.py a.json`，却判「入参构造错」，
 *    照着改会去改一条本来正确的命令，而真正的问题在上游。
 *
 * 任一不过 → 降级（保留结论但明示不可信）或直接驳回（编造/越界）。
 */
import { ROOT_CAUSES } from "./root-cause";
import { inputLooksValid } from "./l2-rules";

export type Verdict = "reliable" | "low_confidence" | "rejected";

export interface VerifyInput {
  rootCause: string;
  evidenceRefs: string[];
  confidence: number;
  suggestion: string;
  /** 组装给模型的完整材料，用于逐字比对 */
  materials: string;
  /** 失败 span 的入参与工具名，用于「归因可修」检查 */
  spanInput?: string;
  tool?: string;
  /** 建议是否指向一个会被下次运行覆盖的产物 */
  overwrittenTarget?: boolean;
  /**
   * 跳过证据原文核对。
   * 只对规则层用：规则层的依据是「正则命中 + 判据复现」，
   * 拿"必须逐字出现在材料里"去要求它，会把对的结论压成不可信。
   */
  skipEvidence?: boolean;
}

export interface VerifyResult {
  verdict: Verdict;
  confidence: number;
  /** 逐条证据的核对结果 */
  grounded: { ref: string; found: boolean }[];
  /** 必须展示给使用者的问题，空数组表示三道检查全过 */
  violations: string[];
}

/** 归一化：折叠空白、统一引号，避免因换行/缩进差异误判为「找不到」 */
function normalize(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyDiagnosis(input: VerifyInput): VerifyResult {
  const violations: string[] = [];
  let confidence = Math.min(1, Math.max(0, input.confidence));

  // 1. 枚举合法
  if (!ROOT_CAUSES.has(input.rootCause)) {
    return {
      verdict: "rejected",
      confidence: 0,
      grounded: [],
      violations: [`根因 \`${input.rootCause}\` 不在封闭枚举内，结论作废`],
    };
  }

  // 2. 证据可寻
  const material = normalize(input.materials);
  const grounded = input.skipEvidence
    ? []
    : (input.evidenceRefs ?? []).map((ref) => {
        const n = normalize(ref);
        // 太短的片段（<8 字）没有验证价值，也不该算作证据
        const usable = n.length >= 8;
        return { ref, found: usable && material.includes(n) };
      });
  const missing = grounded.filter((g) => !g.found);
  const total = grounded.length;

  if (!input.skipEvidence) {
    if (total === 0) {
      violations.push("没有提供任何可核对的证据片段：结论无据可依");
      confidence = Math.min(confidence, 0.3);
    } else if (missing.length === total) {
      return {
        verdict: "rejected",
        confidence: 0,
        grounded,
        violations: [`全部 ${total} 条证据都无法在材料中逐字找到，判定为编造`],
      };
    } else if (missing.length > 0) {
      violations.push(`${missing.length}/${total} 条证据在材料中找不到原文，已作废`);
      // 证据打折直接压低置信度，而不是只在报告里写一行字
      confidence *= 1 - 0.4 * (missing.length / total);
    }
  }

  // 3. 归因可修：入参构造错必须建立在「入参真有毛病」之上
  if (input.rootCause === "tool_arg_error" && input.spanInput !== undefined && input.tool) {
    const check = inputLooksValid(input.spanInput, input.tool);
    if (check.valid) {
      violations.push(
        `判为「入参构造错」，但该次调用的入参本身合法（${check.why}）——归因对象不可修，真正的问题可能在上游产物或环境`,
      );
      confidence = Math.min(confidence, 0.45);
    }
  }

  // 4. 建议有效性：改一个会被覆盖的产物等于没改
  if (input.overwrittenTarget) {
    violations.push("建议指向的产物由脚本每次重建，直接改它会被下次运行覆盖");
    confidence = Math.min(confidence, 0.5);
  }

  // 5. 空话建议
  if (/^(?:建议|应该|需要)?\s*(?:检查|确认|优化|注意)/.test(input.suggestion.trim()) && input.suggestion.length < 24) {
    violations.push("建议过于笼统，无法指导具体修改");
    confidence = Math.min(confidence, 0.5);
  }

  const verdict: Verdict = confidence < 0.5 ? "low_confidence" : "reliable";
  return { verdict, confidence: Number(confidence.toFixed(2)), grounded, violations };
}
