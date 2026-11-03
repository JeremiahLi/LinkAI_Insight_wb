/**
 * 根因类别的**唯一**定义处。
 *
 * 为什么重写（依据：2026-11-02 人工标注 19 条，见 .tmp-verify/diagnosis-report-2026-11-02.annotated.md）：
 * 旧 8 类枚举上模型只判对 6/19，而且**判错的 5 条全部集中在两个桶**：
 *   - prompt_ambiguity 3/3 全错。约束明写在 .pi/skills/ppt-common/SKILL.md 与 ppt_dsl.py，
 *     模型违反的是**已文档化的约束**，却被归成「用户没说清」——这是把模型的失职转嫁给用户。
 *   - hallucination 2/2 全错。字段名写错、值因编码损坏变短，都不是「编造事实」。
 *
 * 结论：不是模型选错了，是**被逼在错误选项里硬选**。所以先修选项，再谈模型。
 *
 * 与旧版的三处实质改动：
 * 1. 新增 schema_violation / encoding_corruption / input_truncation 三类——它们是本项目最高频的
 *    真实故障模式（标注里 10 条中有 7 条属此），旧枚举没有对应桶，只能溢出到相邻桶。
 * 2. requirement_ambiguity 取代 prompt_ambiguity，并**收紧准入**：必须有轨迹证据
 *    （模型追问、要求确认、反复猜目标），不允许用「用户没在 prompt 里写清」当理由。
 * 3. hallucination 收紧为「输出里的断言在给定材料中找不到」，字段名/结构不符不算。
 */

export type RootCause =
  /** 产物不符合下游契约：字段名/结构/长度违反 schema 或校验规则（最高频） */
  | "schema_violation"
  /** 文本在写入或读取时编码损坏（GBK/UTF-8 混用、乱码、替换字符） */
  | "encoding_corruption"
  /** 入参自身被截断：heredoc 未闭合、超长命令被工具截断、引号未收尾 */
  | "input_truncation"
  /** 入参构造错：路径写错、参数类型/字段名错、值超界（入参本身不合法） */
  | "tool_arg_error"
  /** 环境/依赖/权限：命令不存在、模块缺失、EACCES、路径语义在两套 shell 间不一致 */
  | "tool_env_error"
  /** 未读取必要信息就下结论（轨迹里没有相关读取，输出却含具体断言） */
  | "context_missing"
  /** 上下文截断或遗忘：早期约束在后轮被违反、同一信息反复重读 */
  | "context_overflow"
  /** 同参数重复调用且无进展（≥3 次） */
  | "loop"
  /** 需求本身不清：必须有「模型追问/要求确认/反复猜目标」的轨迹证据 */
  | "requirement_ambiguity"
  /** 编造不存在的事实、路径、字段值（断言在材料中找不到，不是拼错） */
  | "hallucination"
  /** 外部服务返回错误（第三方 API 4xx/5xx、模型服务异常） */
  | "downstream_error";

export const ROOT_CAUSE_LABEL: Record<RootCause, string> = {
  schema_violation: "产物不符合契约",
  encoding_corruption: "编码损坏",
  input_truncation: "入参被截断",
  tool_arg_error: "入参构造错",
  tool_env_error: "环境/依赖/权限",
  context_missing: "缺必要信息就作答",
  context_overflow: "上下文截断/遗忘",
  loop: "重复无效调用",
  requirement_ambiguity: "需求本身不清",
  hallucination: "编造事实或路径",
  downstream_error: "外部服务错误",
};

/**
 * 准入条件：给 LLM 看的细则，同时也是 L5 校验层判「这个标签站不站得住」的依据。
 * 每条都写成**可核对**的形式，避免像旧版那样「沾边就算」。
 */
export const ROOT_CAUSE_HINT: Record<RootCause, string> = {
  schema_violation:
    "产物（JSON/YAML/结构体）违反下游 schema 或校验规则：字段名不符、缺必填、超长度、枚举非法。注意：约束写在代码或 SKILL.md 里也算已声明，不能因为用户没在 prompt 复述就归为需求不清。",
  encoding_corruption:
    "文本含替换字符 U+FFFD、乱码片段、或 UnicodeDecode/EncodeError、gbk/cp936/codec 报错。判断要点：乱码既可能让字段变短也可能变长，因此引发的 length/格式校验失败仍归此类。",
  input_truncation:
    "入参自身不完整：heredoc 缺结尾标识（here-document ... delimited by end-of-file）、命令被长度上限截断、引号未闭合。特征是「命令文本本身没写完」，与运行环境无关。",
  tool_arg_error:
    "入参值的构造错：路径拼错、参数类型不对、字段名写错、数值超界。前提是**这个入参确实有毛病**——若失败命令本身完全合法（能解析、路径存在），不得归此类。",
  tool_env_error:
    "运行环境差异或缺失：command not found、模块未安装、EACCES/EPERM、以及路径语义在两套 shell 间不一致（如 bash 的 /tmp 与 Python 的 C:\\tmp 不是同一处）。",
  context_missing:
    "轨迹里找不到必要的读取/检索动作，输出却含具体断言（如没读 schema 就生成结构化数据）。",
  context_overflow: "早期出现的约束在后轮被违反，或同一信息被反复重读，提示上下文被截断或遗忘。",
  loop: "同一工具、同一参数重复调用 ≥3 次且无进展。",
  requirement_ambiguity:
    "需求本身有歧义，且轨迹里能看见模型为此追问、要求确认或反复猜目标。仅有「用户没把话说全」不成立。",
  hallucination:
    "输出中的具体事实/路径/字段值在给定材料中找不到出处（属于「无中生有」），而不是把已有内容的字段名写错。",
  downstream_error: "外部服务返回错误：第三方 API 4xx/5xx、模型服务异常、连接被重置。",
};

/** 供入口校验用：LLM 输出必须落在这些值内，否则整条结论作废 */
export const ROOT_CAUSES: ReadonlySet<string> = new Set(Object.keys(ROOT_CAUSE_LABEL));

export function rootCauseLabel(rc: string): string {
  return ROOT_CAUSE_LABEL[rc as RootCause] ?? rc;
}

/**
 * 二级细分。同一个 rootCause 下修法可能互斥，必须分开，
 * 否则标注者和修复者会被同一个标签误导（实测：edit_mismatch 的两种情形修法完全相反）。
 */
export type SubType =
  /** edit 的 oldText 与文件当前内容不一致，且此前有改同一文件的操作 → 基于旧快照 */
  | "stale_snapshot"
  /** edit 的 oldText 在文件里从来不存在 → 内容臆造 */
  | "phantom_text"
  /** edit 的 oldText == newText → 空编辑 */
  | "noop_edit"
  /** 校验器失败，责任在上游写产物的那一步 */
  | "upstream_producer"
  /** 长驻进程被超时切断（dev server / watch） */
  | "long_running_timeout"
  /** 两套 shell 的路径语义不一致 */
  | "path_semantics_mismatch";

export const SUB_TYPE_LABEL: Record<SubType, string> = {
  stale_snapshot: "基于旧快照构造",
  phantom_text: "目标文本不存在（臆造）",
  noop_edit: "空编辑（新旧内容相同）",
  upstream_producer: "责任在上游产物生成",
  long_running_timeout: "长驻进程被超时切断",
  path_semantics_mismatch: "两套 shell 路径语义不同",
};
