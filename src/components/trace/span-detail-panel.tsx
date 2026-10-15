"use client";

import { useState } from "react";
import { usePreviousSystemPrompt } from "./use-previous-system-prompt";
import { ChevronDown, ChevronRight, Copy, Check, Brain, MessageSquare, Settings, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpanKindIcon, SpanKindBadge, isSkillSpan, getSkillName } from "./span-kind-icon";
import { formatDuration, formatTokens, formatDateTime } from "@/lib/format";
import type { SpanNode } from "./types";

interface Props {
  span: SpanNode;
  round: { index: number };
  allRounds?: Array<{ index: number; systemPromptSpan?: { input?: string } }>;
}

export function SpanDetailPanel({ span, round, allRounds }: Props) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
           <SpanKindIcon kind={span.kind} size="md" isSkill={false} />
          <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold truncate">{span.name}</h3>
             <p className="text-sm text-muted-foreground mt-0.5">
              Round {round.index} · {formatDateTime(span.startTime)}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
           <SpanKindBadge kind={span.kind} isSkill={false} />
           {isSkillSpan(span) && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-pink-500/10 px-2 py-0.5 text-xs font-semibold text-pink-500">
               <BookOpen className="h-3 w-3" />
               {getSkillName(span)}
             </span>
           )}
           {(span.kind === 'llm_thinking' || span.kind === 'answer') && (span.llmThinkDuration != null || span.agentReplyDuration != null) ? (
             <>
               {span.llmThinkDuration != null && <Badge variant="muted">思考 {formatDuration(span.llmThinkDuration)}</Badge>}
               {span.agentReplyDuration != null && <Badge variant="muted">回复 {formatDuration(span.agentReplyDuration)}</Badge>}
             </>
           ) : (
             <Badge variant="muted">{formatDuration(span.duration)}</Badge>
           )}
           {span.kind === 'tool_call' && span.toolDuration != null && <Badge variant="muted">执行 {formatDuration(span.toolDuration)}</Badge>}
          {span.tokens && <Badge variant="muted">{formatTokens(span.tokens.total)} tokens</Badge>}
          {span.model && <Badge variant="outline">{span.model}</Badge>}
          {span.status === "failed" && <Badge variant="error">ERROR</Badge>}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3">
        {span.error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
             <p className="text-sm font-medium text-destructive">错误信息</p>
             <p className="mt-1 font-mono text-sm text-destructive">{span.error}</p>
          </div>
        )}

        {span.kind === "llm_thinking" && (span.input || span.output) && (
          <ThinkingContent input={span.input} output={span.output} model={span.model} tokens={span.tokens} />
        )}

        {span.kind === "answer" && (
          <>
            {span.input && <ThinkingContent input={span.input} output={undefined} model={span.model} tokens={span.tokens} />}
            <AnswerContent output={span.output} tokens={span.tokens} />
          </>
        )}

        {span.kind === "system_prompt" && span.input && (
          <SystemPromptWithDedup content={span.input} round={round} allRounds={allRounds} />
        )}

        {span.kind === "user" && span.input && (
          <ContentSection title="用户输入" content={span.input} defaultOpen />
        )}

        {span.kind === "tool_call" && (
          <>
            {span.input && (
              isSkillSpan(span)
                ? <ContentSection title="Skill 名称" content={getSkillName(span)} defaultOpen />
                : <ContentSection title="调用参数" content={span.input} defaultOpen />
            )}
            {span.output && (
              isSkillSpan(span)
                ? <SkillOutputPreview output={span.output} />
                : <ContentSection title="执行结果" content={span.output} defaultOpen />
            )}
          </>
        )}

        {span.kind === "command" && (
          <>
            {span.input && <ContentSection title="命令" content={span.input} defaultOpen />}
            {span.output && <ContentSection title="输出" content={span.output} defaultOpen />}
          </>
        )}

        {isSkillSpan(span) && (
          <SkillSection span={span} />
        )}

        {/* Metadata */}
        <div className="rounded-lg border border-border p-3">
         <p className="text-sm font-medium text-muted-foreground mb-2">元数据</p>
           <div className="grid grid-cols-3 gap-2 text-sm">
             <div><span className="text-muted-foreground">Span ID</span><p className="font-mono text-xs mt-0.5">{span.id}</p></div>
            <div><span className="text-muted-foreground">Round</span><p className="font-mono mt-0.5">Round {round.index}</p></div>
            {span.tokens && (
              <>
                <div><span className="text-muted-foreground">Input Tokens</span><p className="font-mono mt-0.5">{formatTokens(span.tokens.input)}</p></div>
                <div><span className="text-muted-foreground">Output Tokens</span><p className="font-mono mt-0.5">{formatTokens(span.tokens.output)}</p></div>
                <div><span className="text-muted-foreground">Cache Read</span><p className="font-mono mt-0.5">{formatTokens(span.tokens.cacheRead)}</p></div>
                <div><span className="text-muted-foreground">Cache Write</span><p className="font-mono mt-0.5">{formatTokens(span.tokens.cacheWrite)}</p></div>
                <div><span className="text-muted-foreground">Total Tokens</span><p className="font-mono mt-0.5">{formatTokens(span.tokens.total)}</p></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkingContent({ input, output, model, tokens }: { input?: string; output?: string; model?: string; tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }) {
  const [copied, setCopied] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(input || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {input && (
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 overflow-hidden">
        <div className="flex items-center gap-2 bg-violet-500/10 px-3 py-2">
          <Brain className="h-3.5 w-3.5 text-violet-500" />
           <span className="text-sm font-semibold text-violet-500">思考过程</span>
           {model && <span className="text-xs text-muted-foreground ml-1">{model}</span>}
           {tokens && <span className="text-xs text-muted-foreground ml-auto">{formatTokens(tokens.output)} tokens</span>}
          <button onClick={handleCopy} className="ml-2 text-muted-foreground hover:text-foreground transition-colors">
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="max-h-[400px] overflow-auto p-3">
           <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
 {input}
           </pre>
        </div>
      </div>
      )}
      {output && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 overflow-hidden mt-3">
          <div className="flex items-center gap-2 bg-sky-500/10 px-3 py-2">
            <MessageSquare className="h-3.5 w-3.5 text-sky-500" />
             <span className="text-sm font-semibold text-sky-500">模型回复</span>
            <button onClick={() => { navigator.clipboard.writeText(output); setCopiedOutput(true); setTimeout(() => setCopiedOutput(false), 1500); }} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
              {copiedOutput ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="max-h-[300px] overflow-auto p-3">
             <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
 {output}
             </pre>
          </div>
        </div>
      )}
    </>
  );
}

function AnswerContent({ output, tokens }: { output?: string; tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } }) {
  const [copied, setCopied] = useState(false);
  const content = output || "（无回答内容记录）";

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 overflow-hidden">
      <div className="flex items-center gap-2 bg-sky-500/10 px-3 py-2">
        <MessageSquare className="h-3.5 w-3.5 text-sky-500" />
         <span className="text-sm font-semibold text-sky-500">最终回答</span>
         {tokens && <span className="text-xs text-muted-foreground ml-auto">{formatTokens(tokens.output)} tokens</span>}
        <button onClick={handleCopy} className="ml-2 text-muted-foreground hover:text-foreground transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="max-h-[400px] overflow-auto p-3">
         <div className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
{content}
        </div>
      </div>
    </div>
  );
}

function SkillOutputPreview({ output }: { output: string }) {
  const [open, setOpen] = useState(true);
  const lines = output.split("\n").slice(0, 3).join("\n");
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 bg-muted/20 px-3 py-2">
         <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors">
           {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
           执行结果
         </button>
         <span className="text-xs text-muted-foreground ml-auto">Skill 元数据（完整内容见下方）</span>
      </div>
      {open && (
         <pre className="p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-all bg-muted/10">
{lines}
        </pre>
      )}
    </div>
  );
}

function ContentSection({ title, content, defaultOpen = true }: { title: string; content: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 bg-muted/20 px-3 py-2">
         <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors">
           {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
           {title}
         </button>
        <button onClick={handleCopy} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
         <pre className="max-h-80 overflow-auto p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-all">
{content}
        </pre>
      )}
    </div>
  );
}

function SystemPromptWithDedup({ content, round, allRounds }: { content: string; round: { index: number }; allRounds?: Array<{ index: number; systemPromptSpan?: { input?: string } }> }) {
  const isSameAsPrevious = usePreviousSystemPrompt(content, round.index, allRounds);

  if (isSameAsPrevious) {
    return (
      <div className="rounded-lg border border-muted/30 bg-muted/10 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-3">
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
           <span className="text-sm font-medium text-muted-foreground">系统提示词</span>
           <span className="ml-auto text-sm text-muted-foreground italic">与上一轮相同</span>
        </div>
      </div>
    );
  }

  return <SystemPromptContent content={content} />;
}

function SystemPromptContent({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const charCount = content.length;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 overflow-hidden">
      <div className="flex items-center gap-2 bg-purple-500/10 px-3 py-2">
        <Settings className="h-3.5 w-3.5 text-purple-500" />
         <span className="text-sm font-semibold text-purple-500">系统提示词</span>
         <span className="text-xs text-muted-foreground">{charCount} 字符</span>
        <button onClick={handleCopy} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="max-h-[400px] overflow-auto p-3">
         <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
{content}
        </pre>
      </div>
    </div>
  );
}

function SkillSection({ span }: { span: SpanNode }) {
  const [expanded, setExpanded] = useState(false);

  const skillName = getSkillName(span);
  let triggeredBy: "user" | "agent" | null = null;
  let skillInput: any = null;
  try {
    const details = typeof span.details === "string" ? JSON.parse(span.details) : span.details;
    triggeredBy = details?.triggeredBy || null;
    const inp = typeof span.input === "string" ? JSON.parse(span.input) : span.input;
    skillInput = inp;
  } catch {
    // ignore
  }

  return (
    <div className="rounded-lg border border-pink-500/20 bg-pink-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-pink-500/5 transition-colors"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-pink-500" /> : <ChevronRight className="h-4 w-4 text-pink-500" />}
         <span className="text-sm font-semibold text-pink-500">📋 Skill: {skillName}</span>
         {triggeredBy && (
           <span className={cn(
             "rounded-full px-1.5 py-0.5 text-xs font-semibold",
            triggeredBy === "user" ? "bg-blue-500/15 text-blue-500" : "bg-amber-500/15 text-amber-500"
          )}>
            {triggeredBy === "user" ? "用户" : "Agent"}
          </span>
        )}
         <span className="text-xs text-muted-foreground ml-auto">{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded && (
        <div className="border-t border-pink-500/10 px-3 py-3 space-y-2">
           <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Skill 名称</span><p className="font-medium mt-0.5">{skillName}</p></div>
            <div><span className="text-muted-foreground">状态</span><p className="mt-0.5">{span.status === "failed" ? "执行失败" : "执行成功"}</p></div>
          </div>
          {triggeredBy === "user" && (
             <div className="rounded bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-sm text-blue-600">
              <span className="font-medium">用户触发</span> — 此 Skill 由用户通过 <code className="bg-blue-500/10 px-1 rounded">/skill:{skillName}</code> 命令直接调用
            </div>
          )}
          {triggeredBy === "agent" && (
             <div className="rounded bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-600">
              <span className="font-medium">Agent 触发</span> — 此 Skill 由 Agent 通过 <code className="bg-amber-500/10 px-1 rounded">read</code> 工具自动加载
            </div>
          )}
          {span.output && (
            <div>
             <p className="text-sm font-medium text-muted-foreground mb-1">Skill 完整内容</p>
               <pre className="max-h-[400px] overflow-auto rounded bg-muted/30 p-2 font-mono text-xs">
{span.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ children, variant = "muted" }: { children: React.ReactNode; variant?: "muted" | "outline" | "error" }) {
  return (
    <span className={cn(
         "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      variant === "muted" && "bg-muted text-muted-foreground",
      variant === "outline" && "border border-border text-muted-foreground",
      variant === "error" && "bg-destructive/10 text-destructive",
    )}>
      {children}
    </span>
  );
}
