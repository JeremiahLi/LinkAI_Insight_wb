"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * 用户信号采集（PLAN M4.3）：唯一不依赖 judge 的 ground truth。
 * thumbs_down 的会话可在实验向导「按会话抽样」里入集（M4.5 走既有机制）。
 */

interface Props {
  sessionId: string;
}

interface FeedbackRow {
  id: string;
  kind: string;
  by: string;
  createdAt: string;
}

const KINDS = [
  { kind: "thumbs_up", label: "有用", icon: ThumbsUp, active: "text-success" },
  { kind: "thumbs_down", label: "无用", icon: ThumbsDown, active: "text-destructive" },
  { kind: "reask", label: "重新提问", icon: RotateCcw, active: "text-warning" },
] as const;

export function FeedbackButtons({ sessionId }: Props) {
  const [existing, setExisting] = useState<FeedbackRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/feedback`)
      .then((r) => r.json() as Promise<FeedbackRow[]>)
      .then((list) => {
        if (!cancelled) setExisting(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function send(kind: string) {
    setBusy(kind);
    try {
      await fetch(`/api/sessions/${sessionId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const list = await fetch(`/api/sessions/${sessionId}/feedback`).then(
        (r) => r.json() as Promise<FeedbackRow[]>,
      );
      setExisting(Array.isArray(list) ? list : []);
    } catch {
      // 静默失败：反馈是增强信号，不打断主流程
    } finally {
      setBusy(null);
    }
  }

  const marked = new Set(existing.map((f) => f.kind));

  return (
    <div className="mr-1 flex items-center gap-0.5" title="标注这个会话的结果（人工信号，直接进统计）">
      {KINDS.map(({ kind, label, icon: Icon, active }) => {
        const isMarked = marked.has(kind);
        return (
          <Button
            key={kind}
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => send(kind)}
            className={cn(
              "h-6 gap-1 px-2 text-[11px] text-muted-foreground",
              isMarked && active,
            )}
          >
            <Icon className={cn("size-3", isMarked && "fill-current")} />
            {label}
            {isMarked && existing.filter((f) => f.kind === kind).length > 1
              ? ` ×${existing.filter((f) => f.kind === kind).length}`
              : ""}
          </Button>
        );
      })}
    </div>
  );
}
