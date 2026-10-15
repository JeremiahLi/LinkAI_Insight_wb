"use client";

import { User, Brain, Wrench, Terminal, MessageSquare, AlertCircle, Settings, BookOpen, Play, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function isSkillSpan(span: { kind: string; name: string }): boolean {
  return span.kind === "tool_call" && span.name === "skill";
}

export function getSkillName(span: { name: string; input?: string | null }): string {
  const input = span.input;
  if (input) {
    const patterns = [/skills[\\\/]+([^\\"\\/,]+)SKILL\.md/i, /skills\\\\([^\\"\\/,]+)SKILL\.md/i, /skills[\\\/]+([^\\"\\/,]+)SKILL\.md/i];
    for (const p of patterns) {
      const m = input.match(p);
      if (m && m[1]) return m[1];
    }
    const parts = input.split(/[\\\/]+/);
    const skillIdx = parts.findIndex(function(p){ return p.toLowerCase() === "skills"; });
    if (skillIdx >= 0 && skillIdx + 1 < parts.length) {
      const candidate = parts[skillIdx + 1];
      if (candidate && candidate !== "SKILL.md") return candidate;
    }
  }
  const n = span.name;
  if (n.toLowerCase().startsWith("skill:")) return n.slice(6).trim();
  return n;
}


const kindConfig: Record<string, { icon: React.ElementType; bg: string; text: string; label: string }> = {
  user: { icon: User, bg: "bg-blue-500/10", text: "text-blue-500", label: "用户" },
  system_prompt: { icon: Settings, bg: "bg-purple-500/10", text: "text-purple-500", label: "系统提示" },
  llm_thinking: { icon: Brain, bg: "bg-violet-500/10", text: "text-violet-500", label: "思考" },
  tool_call: { icon: Wrench, bg: "bg-amber-500/10", text: "text-amber-500", label: "工具" },
  tool_execution: { icon: Play, bg: "bg-orange-500/10", text: "text-orange-500", label: "执行" },
  command: { icon: Terminal, bg: "bg-emerald-500/10", text: "text-emerald-500", label: "命令" },
  answer: { icon: MessageSquare, bg: "bg-sky-500/10", text: "text-sky-500", label: "回答" },
  error: { icon: AlertCircle, bg: "bg-destructive/10", text: "text-destructive", label: "错误" },
  system: { icon: Settings, bg: "bg-muted", text: "text-muted-foreground", label: "系统" },
  session_start: { icon: Zap, bg: "bg-cyan-500/10", text: "text-cyan-500", label: "会话" },
};

// Skill 特殊样式
const skillConfig = { icon: BookOpen, bg: "bg-pink-500/10", text: "text-pink-500", label: "Skill" };

export function SpanKindIcon({ kind, size = "sm", isSkill = false }: { kind: string; size?: "sm" | "md"; isSkill?: boolean }) {
  const config = isSkill ? skillConfig : (kindConfig[kind] ?? kindConfig.system);
  const Icon = config.icon;
  const sizeClass = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4.5 w-4.5";

  return (
    <div className={cn("flex items-center justify-center rounded-md", config.bg, sizeClass)}>
      <Icon className={cn(iconSize, config.text)} />
    </div>
  );
}

export function SpanKindBadge({ kind, isSkill = false }: { kind: string; isSkill?: boolean }) {
  const config = isSkill ? skillConfig : (kindConfig[kind] ?? kindConfig.system);
  return (
     <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", config.bg, config.text)}>
      {config.label}
    </span>
  );
}
