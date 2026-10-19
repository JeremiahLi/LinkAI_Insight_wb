"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

// 已知 evidence key 的中文标签与展示顺序
const KEY_LABELS: Record<string, string> = {
  correctPoints: "正确点",
  incorrectPoints: "错误点",
  missingPoints: "遗漏点",
  noReference: "无参考答案",
  relevance: "相关性",
  completeness: "完整性",
  coherence: "连贯性",
  analysis: "分析",
  claims: "主张核查",
  constraints: "约束核查",
  keyPoints: "关键观点",
  totalClaims: "主张总数",
  supportedClaims: "有支撑的主张",
  metCount: "满足数",
  applicableCount: "适用约束数",
  coveredCount: "覆盖数",
  totalCount: "总数",
  violations: "违规项",
  actualCalls: "实际调用",
  totalCalls: "调用总数",
  metrics: "指标核对",
  stats: "会话统计",
  matches: "关键词命中",
  mode: "匹配模式",
  pattern: "正则",
  flags: "flags",
  matchMode: "匹配方式",
  matched: "命中内容",
  expected: "期望输出",
  actual: "实际输出",
  actualPreview: "实际输出（截断）",
  caseSensitive: "区分大小写",
  trimWhitespace: "忽略首尾空格",
  similarity: "相似度",
  threshold: "阈值",
  distance: "编辑距离",
  actualLength: "实际长度",
  referenceLength: "参考长度",
  valid: "校验结果",
  errors: "校验错误",
  parseError: "JSON 解析错误",
  reason: "原因",
};

// 主张/约束/关键观点等结构化列表的成员字段
const ITEM_FIELDS = ["text", "claim", "constraint", "pattern", "name", "key", "metric", "label"];
const STATUS_FIELDS = ["status", "hit", "exceeded", "count"];

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function renderListItems(items: unknown[]): { text: string; status?: string }[] {
  return items.map((item) => {
    if (typeof item !== "object" || item === null) {
      return { text: formatScalar(item) };
    }
    const obj = item as Record<string, unknown>;
    const textKey = ITEM_FIELDS.find((k) => obj[k] !== undefined) ?? Object.keys(obj)[0];
    const statusKey = STATUS_FIELDS.find((k) => obj[k] !== undefined);
    const extra = Object.entries(obj)
      .filter(([k]) => k !== textKey && k !== statusKey && !["evidence", "analysis"].includes(k))
      .slice(0, 2)
      .map(([k, v]) => `${KEY_LABELS[k] ?? k}: ${formatScalar(v)}`);
    return {
      text: [formatScalar(obj[textKey]), ...extra].filter(Boolean).join(" · "),
      status: statusKey ? String(obj[statusKey]) : undefined,
    };
  });
}

const STATUS_COLOR: Record<string, string> = {
  supported: "text-success",
  met: "text-success",
  covered: "text-success",
  hit: "text-success",
  true: "text-success",
  pass: "text-success",
  contradicted: "text-destructive",
  not_met: "text-destructive",
  wrong: "text-destructive",
  exceeded: "text-destructive",
  false: "text-destructive",
  fail: "text-destructive",
  not_covered: "text-muted-foreground",
  not_applicable: "text-muted-foreground",
  missing: "text-muted-foreground",
  partial: "text-warning",
  warn: "text-warning",
};

function EvidenceSection({ label, value }: { label: string; value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const items = renderListItems(value);
    return (
      <div>
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[13px] leading-relaxed">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
              <span className={item.status ? STATUS_COLOR[item.status] ?? "" : ""}>{item.text}</span>
              {item.status && (
                <span className="text-[11px] text-muted-foreground">[{item.status}]</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="break-all text-right text-[13px]">{formatScalar(value)}</span>
    </div>
  );
}

/**
 * 评估结果 evidence 明细渲染：已知 key 用中文分区展示，
 * 未知 key 兜底为键值对，末尾附原始 JSON 折叠视图。
 */
export function EvidenceViewer({ evidenceJson }: { evidenceJson: string | null | undefined }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!evidenceJson) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(evidenceJson);
  } catch {
    return (
      <p className="text-xs text-muted-foreground">evidence 数据异常：{evidenceJson.slice(0, 200)}</p>
    );
  }

  const entries = Object.entries(data);
  if (entries.length === 0) return null;

  const known = entries.filter(([k]) => k in KEY_LABELS);
  const unknown = entries.filter(([k]) => !(k in KEY_LABELS));

  return (
    <div className="space-y-2">
      {known.map(([k, v]) => (
        <EvidenceSection key={k} label={KEY_LABELS[k]} value={v} />
      ))}
      {unknown.map(([k, v]) => (
        <EvidenceSection key={k} label={KEY_LABELS[k] ?? k} value={v} />
      ))}
      <button
        type="button"
        onClick={() => setShowRaw((s) => !s)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {showRaw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        查看原始 JSON
      </button>
      {showRaw && (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
