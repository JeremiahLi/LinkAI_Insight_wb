"use client";

import { cn } from "@/lib/utils";
import type { SpanKind, SpanStatus, AgentStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: "active" | "completed" | "error" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
        status === "active" && "bg-success/10 text-success",
        status === "completed" && "bg-muted text-muted-foreground",
        status === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn(
          "h-1 w-1 rounded-full",
          status === "active" && "bg-success",
          status === "completed" && "bg-muted-foreground",
          status === "error" && "bg-destructive",
        )}
      />
      {status === "active" ? "活跃" : status === "completed" ? "完成" : "异常"}
    </span>
  );
}

export function AgentStatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full",
        status === "healthy" && "bg-success",
        status === "warning" && "bg-warning",
        status === "error" && "bg-destructive animate-pulse",
      )}
    />
  );
}

export function KindBadge({ kind }: { kind: SpanKind }) {
  const config: Record<SpanKind, { label: string; className: string }> = {
    user: { label: "USER", className: "bg-info/10 text-info" },
    llm_thinking: { label: "THINK", className: "bg-primary/10 text-primary" },
    tool_call: { label: "TOOL", className: "bg-success/10 text-success" },
    command: { label: "CMD", className: "bg-warning/10 text-warning" },
    answer: { label: "ANSWER", className: "bg-success/10 text-success" },
    error: { label: "ERROR", className: "bg-destructive/10 text-destructive" },
    system: { label: "SYS", className: "bg-muted text-muted-foreground" },
  };
  const c = config[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1 py-0.5 font-mono text-[10px] font-medium tracking-wide",
        c.className,
      )}
    >
      {c.label}
    </span>
  );
}

export function SpanStatusDot({ status }: { status: SpanStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        status === "success" && "bg-success/60",
        status === "failed" && "bg-destructive",
        status === "running" && "bg-info animate-pulse",
      )}
    />
  );
}
