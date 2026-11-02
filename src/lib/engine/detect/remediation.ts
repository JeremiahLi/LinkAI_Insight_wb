/**
 * 确定性修复建议：把 ErrorSignature 映射成「根因假设 + 可执行动作」。
 *
 * 边界说明（重要）：
 * 这一层只做**规则可判定**的部分，不做语义推断。例如 EPERM + rename 可以确定是
 * 「文件被占用」，因为 Windows 上 rename 失败几乎只有这一个原因；但
 * 「模型为什么生成超长文本」这类需要看上下文的问题，只能由 Diagnoser 结合轨迹判断。
 *
 * 这样切分的好处：可解释、可回归、不花 token，且不会编造。
 */

import type { ErrorSignature } from "./error-signature";

export interface Remediation {
  /** 根因假设（规则给出的，非推测） */
  rootCause: string;
  /** 建议动作，按优先级排列 */
  actions: string[];
  /** 该判断的可靠程度：high 可直接照做，low 仅作提示 */
  confidence: "high" | "medium" | "low";
}

const BY_KIND: Record<string, Remediation> = {
  missing_path: {
    rootCause: "引用了不存在的路径：拼接错误，或该文件本应由上一步产出但未产出",
    actions: [
      "操作前先确认目标存在（列出目录后再读写），失败重试比猜测路径便宜",
      "检查路径拼接里的引号、空格与分隔符，尤其是拼接了变量或用户输入的情况",
      "若目标属生成物，先确认上一步命令确实成功产出了该文件，而不是静默失败",
    ],
    confidence: "high",
  },
  permission: {
    rootCause: "权限不足或文件被其他进程占用（Windows 上 rename EPERM 基本可确定是被占用）",
    actions: [
      "确认是否有 dev server / 构建进程持有该文件句柄，关闭后重试",
      "避免在上一次构建尚未结束时重跑同一构建",
      "若确为权限问题，检查目标目录的写权限与只读属性",
    ],
    confidence: "high",
  },
  command_not_found: {
    rootCause: "运行环境缺少该命令或依赖，PATH 中找不到可执行文件",
    actions: [
      "确认该依赖已安装且在当前 shell 的 PATH 中",
      "区分 shell 类型：Git Bash 与 cmd 的可执行名与路径写法不同",
      "在 Agent 的系统提示中加入环境说明，避免反复尝试不存在的命令",
    ],
    confidence: "high",
  },
  shell_syntax: {
    rootCause: "拼接出的 shell 命令本身有语法错误：引号未闭合、重定向歧义或含未转义的特殊字符",
    actions: [
      "含空格或中文的路径必须整体加引号，并确认引号成对",
      "避免在命令中直接插入含 $、&、| 的动态内容，改用文件传递",
      "对生成命令的工具，输出前做一次引号配对校验",
    ],
    confidence: "high",
  },
  edit_mismatch: {
    rootCause: "待替换文本与文件当前内容不一致：编辑前未读取最新内容，或文件已被其他步骤改写",
    actions: [
      "编辑前必须先读取该文件的当前内容，不要复用上一轮的旧文本",
      "若上一步已修改同一文件，重新读取后再构造替换片段",
      "对大文件优先做定点插入而非全文替换",
    ],
    confidence: "high",
  },
  encoding: {
    rootCause: "读写两端编码不一致：进程按 UTF-8 输出，读取方按 GBK 解码（或反之）",
    actions: [
      "统一以 UTF-8 读写；Python 脚本显式指定 encoding='utf-8'",
      "设置 PYTHONIOENCODING=utf-8，避免 Windows 默认 GBK 干扰",
      "文件中存在中文时，禁止用默认编码 open()",
    ],
    confidence: "high",
  },
  json_invalid: {
    rootCause: "写出的 JSON 不合法：手写拼接导致缺逗号/多尾逗号，或被长度限制截断",
    actions: [
      "用 json.dump 序列化，不要手写 JSON 字符串",
      "写入后立即读回并 json.load 校验一次",
      "生成大对象时确认写完整，检查是否被输出长度上限截断",
    ],
    confidence: "high",
  },
  invalid_argument: {
    rootCause: "工具入参越界：引用了超出文件长度的偏移量或越界索引",
    actions: [
      "读取前先确认文件总行数，offset/limit 不得超出",
      "对不确定长度的文件，先用小 limit 探读再续读",
    ],
    confidence: "high",
  },
  io_error: {
    rootCause: "文件系统操作类型不匹配：把目录当文件读，或反之",
    actions: [
      "读文件前先判断目标是文件还是目录",
      "列出目录用 ls/glob，读内容用 read，两者不要混用",
    ],
    confidence: "high",
  },
  timeout: {
    rootCause: "单步执行超过超时阈值，通常是输入规模过大或外部命令阻塞",
    actions: [
      "拆分大批量操作，避免单次处理超大文件或全量数据",
      "为可能阻塞的外部命令设置显式超时",
      "检查是否存在等待输入的交互式命令（会一直挂住直到超时）",
    ],
    confidence: "medium",
  },
  interrupted: {
    rootCause: "用户主动中止，不属于故障",
    actions: ["无需处理；若频繁发生，说明单步耗时过长或方向明显偏离预期"],
    confidence: "high",
  },
  not_an_error: {
    rootCause: "该文本不是错误，而是命令的正常输出被采集端写入了 error 字段",
    actions: ["修复采集端：仅在进程非零退出或抛出异常时写入 error"],
    confidence: "high",
  },
  exit_code: {
    rootCause: "命令以非零退出码结束，但未输出可归类的错误信息",
    actions: [
      "查看该命令的输出内容判断业务原因",
      "要求脚本在失败时输出结构化错误（哪一项、为什么），否则只能靠人看",
    ],
    confidence: "low",
  },
  unknown: {
    rootCause: "未能从错误文本中提取可归类的特征",
    actions: ["人工查看该 span 的完整输出", "若同类反复出现，补充该模式的识别规则"],
    confidence: "low",
  },
};

/** 按异常类细分：比通用 exception 精确得多 */
const BY_CLASS: { match: RegExp; remediation: Remediation }[] = [
  {
    match: /ValidationError$/,
    remediation: {
      rootCause: "生成的数据结构不符合目标 schema（字段缺失、类型不符或超长）",
      actions: [
        "在生成侧做前置校验，不要等到下游渲染/入库时才失败",
        "把 schema 的关键约束（字段名、长度上限、枚举值）写进 Agent 的提示词",
        "失败后先读回 schema 定义再改数据，不要凭记忆补字段",
      ],
      confidence: "high",
    },
  },
  {
    match: /JSONDecodeError$/,
    remediation: {
      rootCause: "写出的 JSON 不合法：多为手工拼接字符串导致缺逗号、多尾逗号或被截断",
      actions: [
        "用 json.dump 序列化，不要手写 JSON 字符串",
        "写入大文件时确保写完整（检查是否因长度限制被截断）",
        "读回后立即 json.load 校验一次",
      ],
      confidence: "high",
    },
  },
  {
    match: /(?:File)?NotFoundError$/,
    remediation: {
      rootCause: "目标文件不存在，与 missing_path 同源",
      actions: ["同 missing_path：操作前确认路径存在", "避免用猜测的相对路径"],
      confidence: "high",
    },
  },
  {
    match: /ModuleNotFoundError$|ImportError$/,
    remediation: {
      rootCause: "运行环境缺少 Python 模块，或解释器选错（系统 Python vs 虚拟环境）",
      actions: ["确认使用的是项目虚拟环境的解释器", "补齐依赖并锁定版本"],
      confidence: "high",
    },
  },
];

export function suggestRemediation(sig: ErrorSignature): Remediation {
  if (sig.errorClass) {
    for (const rule of BY_CLASS) {
      if (rule.match.test(sig.errorClass)) return rule.remediation;
    }
  }
  return BY_KIND[sig.kind] ?? BY_KIND.unknown;
}

/** 把「结局」也算进严重度判断：自愈的失败不该占据处理队列 */
export function isActionable(sig: ErrorSignature, outcome: string, severity: string): boolean {
  if (severity === "info") return false;
  if (outcome === "retried_recovered") return false;
  if (sig.kind === "interrupted" || sig.kind === "not_an_error") return false;
  return true;
}
