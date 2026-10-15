"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { User, Brain, Wrench, MessageSquare, BookOpen, ChevronUp, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatTokens } from "@/lib/format";
import type {
  RoundSummaryData,
  UserInputData,
  LlmData,
  ToolData,
  AnswerData,
} from "./build-flow-graph";

const handleCls = "!h-2 !w-2 !border-2 !border-background !bg-muted-foreground/60";

/** 折叠轮次的摘要节点：整节点可点击展开 */
export const RoundSummaryNode = memo(function RoundSummaryNode({ data }: NodeProps) {
  const d = data as RoundSummaryData;
  return (
    <div className="w-[304px] cursor-pointer rounded-lg border border-border bg-card px-3 py-2 shadow-sm transition-colors hover:border-primary/50">
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
          Round {d.roundIndex}
        </span>
        {d.isFork && <GitBranch className="h-3 w-3 text-amber-500" />}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {formatDuration(d.duration)} · {formatTokens(d.tokens)}
        </span>
      </div>
      <p className="mt-1 line-clamp-1 text-xs text-foreground/80">{d.inputPreview || "（无输入记录）"}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground/70">
        {d.turnCount} 轮交互 · {d.toolCount} 次工具调用 · 点击展开
      </p>
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </div>
  );
});

/** 用户输入节点：右上角按钮收起本轮 */
export const UserInputNode = memo(function UserInputNode({ data }: NodeProps) {
  const d = data as UserInputData;
  return (
    <div className="flex h-[132px] w-[304px] flex-col overflow-hidden rounded-lg border border-blue-500/30 bg-card shadow-sm">
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex items-center gap-1.5 border-b border-border bg-blue-500/5 px-2.5 py-1.5">
        <User className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-semibold text-blue-600">用户输入</span>
        <span className="text-[10px] text-muted-foreground">Round {d.roundIndex}</span>
        {d.onCollapse && (
          <button
            className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            title="收起本轮"
            onClick={(e) => {
              e.stopPropagation();
              d.onCollapse?.();
            }}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden px-2.5 py-1.5">
        <p className="line-clamp-3 whitespace-pre-wrap break-all text-xs leading-relaxed text-foreground/90">
          {d.text || "（无输入记录）"}
        </p>
      </div>
      <div className="border-t border-border/60 px-2.5 py-1 text-[10px] text-muted-foreground">
        {d.charCount} 字符
      </div>
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </div>
  );
});

/** LLM 节点：整节点可点击，展开/收起该轮工具调用序列 */
export const LlmNode = memo(function LlmNode({ data }: NodeProps) {
  const d = data as LlmData;
  return (
    <div className="flex h-[148px] w-[304px] cursor-pointer flex-col overflow-hidden rounded-lg border border-violet-500/30 bg-card shadow-sm transition-colors hover:border-violet-500/60">
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex items-center gap-1.5 border-b border-border bg-violet-500/5 px-2.5 py-1.5">
        <Brain className="h-3.5 w-3.5 shrink-0 text-violet-500" />
        <span className="shrink-0 text-xs font-semibold text-violet-600">LLM</span>
        <span className="ml-1 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {d.model}
        </span>
      </div>
      <div className="flex-1 overflow-hidden px-2.5 py-1.5">
        <p className="line-clamp-3 whitespace-pre-wrap break-all text-xs leading-relaxed text-foreground/80">
          {d.outputPreview || "（思考过程无文本记录）"}
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-border/60 px-2.5 py-1 text-[10px] text-muted-foreground">
        <span className="font-mono">耗时 {formatDuration(d.duration)}</span>
        <span className="font-mono">{formatTokens(d.tokens)} tokens</span>
        {d.toolCount > 0 && (
          <span
            className={cn(
              "ml-auto rounded px-1.5 py-0.5 font-medium",
              d.expanded ? "bg-violet-500/15 text-violet-600" : "bg-muted text-muted-foreground",
            )}
          >
            {d.toolCount} 个工具 · 点击{d.expanded ? "收起" : "展开"}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </div>
  );
});

/** 工具调用节点（skill 调用以 BookOpen 图标 + 粉色标识区分） */
export const ToolNode = memo(function ToolNode({ data }: NodeProps) {
  const d = data as ToolData;
  const isErr = d.status === "failed" || d.status === "error";
  return (
    <div
      className={cn(
        "flex h-[56px] w-[284px] items-center gap-2 rounded-lg border px-2.5 shadow-sm",
        isErr ? "border-destructive/40 bg-destructive/5" : "border-amber-500/30 bg-card",
      )}
    >
      <Handle type="target" position={Position.Top} className={handleCls} />
      {d.isSkill ? (
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-pink-500" />
      ) : (
        <Wrench className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-xs font-medium", isErr && "text-destructive")}>
          {d.name}
          {d.isSkill && <span className="ml-1 text-[10px] text-pink-500">Skill</span>}
        </p>
        {isErr && d.error && <p className="truncate text-[10px] text-destructive/80">{d.error}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[10px] text-muted-foreground">{formatDuration(d.duration)}</p>
        {d.tokens > 0 && <p className="font-mono text-[10px] text-muted-foreground">{formatTokens(d.tokens)}</p>}
      </div>
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </div>
  );
});

/** 最终回答节点 */
export const AnswerNode = memo(function AnswerNode({ data }: NodeProps) {
  const d = data as AnswerData;
  return (
    <div className="flex h-[118px] w-[304px] flex-col overflow-hidden rounded-lg border border-sky-500/30 bg-card shadow-sm">
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex items-center gap-1.5 border-b border-border bg-sky-500/5 px-2.5 py-1.5">
        <MessageSquare className="h-3.5 w-3.5 text-sky-500" />
        <span className="text-xs font-semibold text-sky-600">最终回答</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{formatTokens(d.tokens)} tokens</span>
      </div>
      <div className="flex-1 overflow-hidden px-2.5 py-1.5">
        <p className="line-clamp-3 whitespace-pre-wrap break-all text-xs leading-relaxed text-foreground/90">
          {d.outputPreview || "（无回答内容）"}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </div>
  );
});
