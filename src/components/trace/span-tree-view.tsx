"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronRight, ChevronDown, GitBranch, AlertCircle, Zap, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpanKindIcon, isSkillSpan, getSkillName } from "./span-kind-icon";
import { formatDuration, formatTokens } from "@/lib/format";
import type { SessionNode, RoundNode, TurnNode, BranchNode, SpanNode } from "./types";

interface TreeRow {
  id: string;
  type: "session" | "round" | "input_span" | "system_prompt" | "answer_span" | "turn" | "span" | "fork_header" | "branch" | "branch_span";
  depth: number;
  round?: RoundNode;
  turn?: TurnNode;
  span?: SpanNode;
  branch?: BranchNode;
}

interface Props {
  session: SessionNode;
  selectedSpanId: string | null;
  onSelectSpan: (span: SpanNode, round: RoundNode) => void;
  onSelectSession?: () => void;
  onSelectRound?: (round: RoundNode) => void;
}

export function SpanTreeView({ session, selectedSpanId, onSelectSpan, onSelectSession, onSelectRound }: Props) {
  const [collapsedRounds, setCollapsedRounds] = useState<Set<string>>(new Set());
  const [collapsedTurns, setCollapsedTurns] = useState<Set<string>>(new Set());

  function getSpanDuration(span: SpanNode): number {
    if (span.kind === 'tool_call' && span.toolDuration != null) return span.toolDuration;
    if ((span.kind === 'llm_thinking' || span.kind === 'answer') && span.agentReplyDuration != null) return span.agentReplyDuration;
    return span.duration;
  }
  const [collapsedSystemPrompts, setCollapsedSystemPrompts] = useState<Set<string>>(new Set());

  const toggleRound = useCallback((id: string) => {
    setCollapsedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleTurn = useCallback((id: string) => {
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSystemPrompt = useCallback((id: string) => {
    setCollapsedSystemPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const rows = useMemo<TreeRow[]>(() => {
    const result: TreeRow[] = [];
    result.push({ id: session.id, type: "session", depth: 0 });

    for (const round of session.rounds) {
      result.push({ id: round.id, type: "round", depth: 1, round });
      if (collapsedRounds.has(round.id)) continue;

      // Render input span at round level
      if (round.inputSpan) {
        result.push({ id: `${round.id}-input`, type: "input_span", depth: 2, span: round.inputSpan, round });
      }

      // Render system prompt (collapsible)
      if (round.systemPromptSpan) {
        result.push({ id: `${round.id}-system`, type: "system_prompt", depth: 2, span: round.systemPromptSpan, round });
      }

      // Render turns
      for (const turn of round.turns) {
        result.push({ id: turn.id, type: "turn", depth: 2, turn, round });
        if (collapsedTurns.has(turn.id)) continue;

        for (const span of turn.spans) {
          result.push({ id: span.id, type: "span", depth: 3, span, round, turn });
        }
      }

      // Render answer span at round level
      if (round.answerSpan) {
        result.push({ id: `${round.id}-answer`, type: "answer_span", depth: 2, span: round.answerSpan, round });
      }

      if (round.branches && round.branches.length > 0) {
        result.push({ id: `${round.id}-fork`, type: "fork_header", depth: 2, round });
        for (const branch of round.branches) {
          result.push({ id: branch.id, type: "branch", depth: 3, branch, round });
          for (const span of branch.spans) {
            result.push({ id: span.id, type: "branch_span", depth: 4, span, round, branch });
          }
        }
      }
    }
    return result;
  }, [session, collapsedRounds, collapsedTurns]);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
      {rows.map((row) => {
        if (row.type === "session") {
          return (
            <div
              key={row.id}
              className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border mb-1 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={onSelectSession}
            >
              <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                 <span className="text-xs font-bold text-primary">S</span>
               </div>
               <span className="text-sm font-bold">Session {session.id.slice(-4)}</span>
               <span className="text-xs text-muted-foreground">{session.totalRounds} rounds · {session.totalSpans} spans</span>
            </div>
          );
        }

        if (row.type === "round" && row.round) {
          const isCollapsed = collapsedRounds.has(row.round.id);
          const totalSpans = row.round.turns.reduce((sum, t) => sum + t.spans.length, 0);
          return (
            <div
              key={row.id}
              className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-muted/20 transition-colors"
              onClick={() => {
                if (onSelectRound) onSelectRound(row.round!);
                toggleRound(row.round!.id);
              }}
            >
              <Indent depth={row.depth} />
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
               <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary shrink-0">
                 {row.round.index}
               </span>
               <span className="text-sm font-semibold">Round {row.round.index}</span>
               <span className="text-xs text-muted-foreground">{row.round.turns.length} turns · {totalSpans} spans</span>
              {row.round.isForkPoint && (
                 <span className="ml-auto rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-500 flex items-center gap-0.5">
                  <GitBranch className="h-2.5 w-2.5" /> Fork
                </span>
              )}
            </div>
          );
        }

        if (row.type === "input_span" && row.span && row.round) {
          const span = row.span;
          const isSelected = selectedSpanId === span.id;
          return (
            <div
              key={row.id}
              onClick={() => onSelectSpan(span, row.round!)}
              className={cn(
                "flex items-center gap-1.5 cursor-pointer py-1.5 transition-colors",
                isSelected ? "bg-primary/10" : "hover:bg-muted/20",
              )}
            >
              <Indent depth={row.depth} />
              <SpanKindIcon kind={span.kind} />
              <span className="flex-1 truncate text-sm">{span.name}</span>
              <span className="text-xs text-muted-foreground pr-3">{formatDuration(span.duration)}</span>
            </div>
          );
        }

        if (row.type === "system_prompt" && row.span && row.round) {
          const span = row.span;
          const isSelected = selectedSpanId === span.id;
          const isCollapsed = collapsedSystemPrompts.has(row.round.id);
          const prevSp = findPrevSystemPrompt(session, row.round.index);
          const isSameAsPrev = prevSp != null && prevSp === span.input;
          return (
            <div
              key={row.id}
              onClick={() => {
                toggleSystemPrompt(row.round!.id);
                onSelectSpan(span, row.round!);
              }}
              className={cn(
                "flex items-center gap-1.5 cursor-pointer py-1.5 transition-colors",
                isSelected ? "bg-primary/10" : "hover:bg-muted/20",
              )}
            >
              <Indent depth={row.depth} />
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              )}
               <SpanKindIcon kind={span.kind} />
               <span className="flex-1 truncate text-sm">{span.name}</span>
               {isSameAsPrev && (
                 <span className="text-xs text-muted-foreground/60 italic">与上一轮相同</span>
               )}
               <span className="text-xs text-muted-foreground pr-3">{formatDuration(getSpanDuration(span))}</span>
            </div>
          );
        }

        if (row.type === "answer_span" && row.span && row.round) {
          const span = row.span;
          const isSelected = selectedSpanId === span.id;
          return (
            <div
              key={row.id}
              onClick={() => onSelectSpan(span, row.round!)}
              className={cn(
                "flex items-center gap-1.5 cursor-pointer py-1.5 transition-colors",
                isSelected ? "bg-primary/10" : "hover:bg-muted/20",
              )}
            >
              <Indent depth={row.depth} />
              <SpanKindIcon kind={span.kind} />
              <span className="flex-1 truncate text-sm">{span.name}</span>
              <span className="text-xs text-muted-foreground pr-3">{formatDuration(span.duration)}</span>
            </div>
          );
        }

        if (row.type === "turn" && row.turn && row.round) {
          const isCollapsed = collapsedTurns.has(row.turn.id);
          const summary = getTurnSummary(row.turn);
          return (
            <div
              key={row.id}
              className="flex items-center gap-1.5 px-3 py-1 cursor-pointer hover:bg-muted/10 transition-colors"
              onClick={() => toggleTurn(row.turn!.id)}
            >
              <Indent depth={row.depth} />
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              ) : (
                <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
              )}
              <Zap className="h-3.5 w-3.5 text-info shrink-0" />
               <span className="text-sm font-medium text-info">Turn {row.turn.turnId}</span>
               <span className="text-xs text-muted-foreground">{summary}</span>
               <span className="text-xs text-muted-foreground ml-auto">{row.turn.spans.length} spans</span>
            </div>
          );
        }

        if (row.type === "fork_header" && row.round) {
          return (
            <div key={row.id} className="flex items-center gap-1.5 px-3 py-1">
              <Indent depth={row.depth} />
              <GitBranch className="h-3 w-3 text-amber-500 shrink-0" />
               <span className="text-xs font-medium text-amber-500 italic">
                用户回到 Round {row.round.index} 重新选择方案
              </span>
            </div>
          );
        }

        if (row.type === "branch" && row.branch) {
          return (
            <div key={row.id} className="flex items-center gap-1.5 px-3 py-1">
              <Indent depth={row.depth} />
              <div className={cn(
                "h-3 w-3 rounded-full border-2 shrink-0",
                row.branch.isActive ? "border-success bg-success/20" : "border-muted-foreground/30"
              )} />
              <span className={cn("text-xs font-medium", row.branch.isActive ? "text-success" : "text-muted-foreground")}>
                {row.branch.name}
              </span>
              {row.branch.isActive && (
                 <span className="rounded bg-success/10 px-1 py-0.5 text-xs font-medium text-success">活跃</span>
              )}
            </div>
          );
        }

          if ((row.type === "span" || row.type === "branch_span") && row.span && row.round) {
            const span = row.span;
            const isSelected = selectedSpanId === span.id;
            const isSkill = isSkillSpan(span);
            const isError = span.status === "failed";
            let triggeredBy: "user" | "agent" | null = null;
            if (isSkill) {
              try {
                const details = typeof span.details === "string" ? JSON.parse(span.details) : span.details;
                triggeredBy = details?.triggeredBy || null;
              } catch { /* ignore */ }
            }
            return (
              <div
                key={row.id}
                onClick={() => onSelectSpan(span, row.round!)}
                className={cn(
                  "flex items-center gap-1.5 cursor-pointer py-1.5 transition-colors",
                  isSelected ? "bg-primary/10" : "hover:bg-muted/20",
                  isError && !isSelected && "bg-destructive/8 hover:bg-destructive/12",
                )}
              >
                <Indent depth={row.depth} />
                {isError ? (
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-destructive/15 shrink-0">
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  </div>
                ) : (
                  <SpanKindIcon kind={span.kind} isSkill={isSkill} />
                )}
                 <span className={cn("truncate text-sm", isError && "text-destructive font-medium", isSkill ? "max-w-[80px]" : "flex-1")}>{span.name}</span>
                 {isSkill && (
                   <span className="inline-flex items-center gap-0.5 rounded-full bg-pink-500/10 px-1.5 py-0.5 text-xs font-semibold text-pink-500 shrink-0">
                    <BookOpen className="h-2.5 w-2.5" />
                    {getSkillName(span)}
                  </span>
                )}
                 {isSkill && triggeredBy && (
                   <span className={cn(
                     "rounded-full px-1.5 py-0.5 text-xs font-semibold shrink-0",
                    triggeredBy === "user" ? "bg-blue-500/15 text-blue-500" : "bg-amber-500/15 text-amber-500"
                  )}>
                    {triggeredBy === "user" ? "用户" : "Agent"}
                  </span>
                )}
                  <div className="flex items-center gap-2 pr-3 ml-auto">
                    <span className={cn("font-mono text-xs shrink-0", isError ? "text-destructive/70" : "text-muted-foreground")}>
                      {formatDuration(getSpanDuration(span))}
                    </span>
                   {span.tokens && (
                     <span className={cn("font-mono text-xs shrink-0", isError ? "text-destructive/70" : "text-muted-foreground")}>
                      {formatTokens(span.tokens.total)}
                    </span>
                  )}
                </div>
                 {isError && (
                   <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs font-semibold text-destructive shrink-0 mr-2">
                    ERR
                  </span>
                )}
              </div>
           );
         }

        return null;
      })}
    </div>
  );
}

function getTurnSummary(turn: TurnNode): string {
  const hasThinking = turn.spans.some((s) => s.kind === "llm_thinking");
  const tools = turn.spans.filter((s) => s.kind === "tool_call").map((s) => s.name);
  const parts: string[] = [];
  if (hasThinking) parts.push("思考");
  if (tools.length > 0) parts.push(tools.join("+"));
  return parts.join(" + ");
}

function Indent({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return <div style={{ width: `${(depth - 1) * 28}px` }} className="shrink-0" />;
}

/** Find the previous round's system prompt input content, or undefined */
function findPrevSystemPrompt(session: SessionNode, currentRoundIndex: number): string | undefined {
  if (currentRoundIndex <= 0) return undefined;
  const prevRound = session.rounds.find((r) => r.index === currentRoundIndex - 1);
  return prevRound?.systemPromptSpan?.input;
}
