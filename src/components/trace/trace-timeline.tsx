"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildCalls,
  buildGroups,
  isFailed,
  spanColor,
  type CallInfo,
  type SpanGroup,
  type TraceSpan,
} from "./trace-helpers";

const LABEL_W = "w-48"; // 标签列宽度：时间轴 / 甘特图 / 图表严格共用，保证纵向对齐
const BAR_H = 18;

interface Props {
  spans: TraceSpan[];
  totalSeconds: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectCall?: (callId: string, view: "cum" | "delta") => void;
  /** 当前高亮的 LLM 调用（call.id = llm_thinking span.id）：左树/甘特/两图同步标记 */
  highlightCallId?: string | null;
  /**
   * 需要「露出来」的 span：深链落地时把甘特缩放域收到该 span 附近。
   * 全量域下一条 50ms 的 span 不足 1px 宽，仅高亮等于看不见。
   * 只在值变化时触发一次，不跟随用户后续的选中项走，避免点树时甘特乱跳。
   */
  revealSpanId?: string | null;
}

interface Domain {
  start: number;
  end: number;
}

export function TraceTimeline({
  spans,
  totalSeconds,
  selectedId,
  onSelect,
  onSelectCall,
  highlightCallId,
  revealSpanId,
}: Props) {
  const groups = useMemo(() => buildGroups(spans), [spans]);

  // 缩放域（秒）：null = 全量。甘特图与下方两张图表各自独立缩放，互不联动。
  const [ganttDomain, setGanttDomain] = useState<Domain | null>(null);
  const [chartDomain, setChartDomain] = useState<Domain | null>(null);
  const gEff = ganttDomain ?? { start: 0, end: totalSeconds };
  const ganttDomainRef = useRef(gEff);
  ganttDomainRef.current = gEff;
  const chartDomainRef = useRef(gEff);
  chartDomainRef.current = chartDomain ?? { start: 0, end: totalSeconds };
  const axisTrackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 会话切换时复位缩放
  useEffect(() => {
    setGanttDomain(null);
    setChartDomain(null);
  }, [spans]);

  // 深链定位：把甘特域收到目标 span 所在分组（声明在复位 effect 之后，保证这一帧以它为准）
  useEffect(() => {
    if (!revealSpanId) return;
    const target = spans.find((s) => s.id === revealSpanId);
    if (!target) return;
    const end = target.relStart + target.timelineMs / 1000;
    const group = groups.find((g) => g.rows.some((r) => r.spans.some((s) => s.id === revealSpanId)));
    // 以「span 本身 + 一个分组宽度的余量」为窗口，太窄时给 2s 兜底
    const groupSpan = group ? group.endSec - group.startSec : 0;
    const pad = Math.max(Math.min(groupSpan, (end - target.relStart) * 4), 1);
    setGanttDomain({
      start: Math.max(0, target.relStart - pad),
      end: Math.min(totalSeconds, end + pad),
    });
  }, [revealSpanId, spans, groups, totalSeconds]);

  // 滚轮缩放：以鼠标位置为锚点；按光标所在区域（data-zoom-scope）作用于甘特图或图表
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Shift + 滚轮：上下滚动（缩放占用普通滚轮后的滚动后备）
      if (e.shiftKey) {
        e.preventDefault();
        el.scrollTop += e.deltaY;
        return;
      }
      e.preventDefault();
      const target = e.target as HTMLElement | null;
      const scopeEl = target?.closest?.("[data-zoom-scope]");
      const scope = scopeEl?.getAttribute("data-zoom-scope") ?? "gantt";
      const d = scope === "charts" ? chartDomainRef.current : ganttDomainRef.current;
      const span0 = Math.max(d.end - d.start, 0.001);
      const factor = Math.exp(e.deltaY * 0.0012); // 向下滚 = 缩小（zoom out）
      const minSpan = Math.max(totalSeconds / 2000, 0.05);
      const newSpan = Math.min(Math.max(span0 * factor, minSpan), totalSeconds);
      // 锚点：光标在当前缩放轨道（data-zoom-track）内的水平位置
      const track = target?.closest?.("[data-zoom-track]") as HTMLElement | null;
      const rect = track?.getBoundingClientRect();
      let frac = 0.5;
      if (rect && rect.width > 0) {
        frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      }
      const anchor = d.start + frac * span0;
      let ns = anchor - (anchor - d.start) * (newSpan / span0);
      let ne = ns + newSpan;
      if (ns < 0) {
        ne -= ns;
        ns = 0;
      }
      if (ne > totalSeconds) {
        const shift = ne - totalSeconds;
        ns = Math.max(ns - shift, 0);
        ne = totalSeconds;
      }
      if (scope === "charts") setChartDomain({ start: ns, end: ne });
      else setGanttDomain({ start: ns, end: ne });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [totalSeconds]);

  const spanSec = gEff.end - gEff.start;
  const px = useCallback(
    (t: number) => ((t - gEff.start) / Math.max(spanSec, 0.001)) * 100,
    [gEff, spanSec],
  );
  const fmtTick = useCallback(
    (t: number) => {
      if (spanSec <= 10) return `${t.toFixed(1)}s`;
      if (t < 60) return `${t.toFixed(0)}s`;
      return `${(t / 60).toFixed(1)}m`;
    },
    [spanSec],
  );
  const ticks = Array.from({ length: 6 }, (_, i) => gEff.start + (spanSec * i) / 5);

  /** 双击某个 Round / Branch：以该组起止为左右边界聚焦甘特时间轴（仅甘特图） */
  const focusGroup = useCallback(
    (g: SpanGroup) => {
      const pad = Math.max((g.endSec - g.startSec) * 0.08, 0.5);
      setGanttDomain({
        start: Math.max(0, g.startSec - pad),
        end: Math.min(totalSeconds, g.endSec + pad),
      });
    },
    [totalSeconds],
  );

  /** 双击复位：按光标所在区域只复位对应域 */
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const scope = target?.closest?.("[data-zoom-scope]")?.getAttribute("data-zoom-scope");
    if (scope === "charts") setChartDomain(null);
    else setGanttDomain(null);
  }, []);

  return (
    <div
      ref={scrollRef}
      onDoubleClick={handleDoubleClick}
      className="flex-1 overflow-auto scrollbar-thin"
      title="滚轮缩放（甘特图/图表独立）· 双击复位对应区域 · 双击 Round 聚焦甘特图 · 点击柱体查看构成"
    >
      <div className="relative min-w-[860px] p-4 pb-3 pr-10">
        {/* 时间轴（甘特图专用缩放域） */}
        <div data-zoom-scope="gantt" className="mb-1.5 flex items-center text-[11px] text-muted-foreground">
          <div className={cn(LABEL_W, "shrink-0 pr-3 text-right")}>
            {ganttDomain ? (
              <span className="text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            ) : (
              <span className="text-[10px]">已剔除轮间空闲</span>
            )}
          </div>
          <div ref={axisTrackRef} data-zoom-track="1" className="flex flex-1">
            {ticks.map((t, i) => (
              <div key={i} className={cn("flex-1 pr-1", i === ticks.length - 1 && "text-right")}>
                {fmtTick(t)}
              </div>
            ))}
          </div>
        </div>

        {/* 甘特行：Round / Branch 分组框（缩放域：甘特独立） */}
        <div data-zoom-scope="gantt" className="timeline-grid relative">
          {groups.map((group) => (
            <div
              key={group.id}
              className={cn(
                "my-1.5 rounded-md border py-1",
                group.isBranch
                  ? "border-dashed border-primary/25"
                  : "border-primary/25 bg-primary/5",
              )}
            >
              {/* 分组头：双击以该 Round/Branch 为边界聚焦时间轴 */}
              <div
                className="relative flex h-7 cursor-pointer items-center"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  focusGroup(group);
                }}
                title={`双击以 ${group.title} 的起止时间缩放时间轴`}
              >
                <div
                  className={cn(
                    LABEL_W,
                    "flex shrink-0 items-center justify-end gap-1.5 truncate pr-3 text-[11px] hover:brightness-125",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      group.failed ? "bg-destructive" : "bg-[var(--trace-agent)]",
                    )}
                  />
                  <span
                    className={cn(
                      "font-medium text-[var(--trace-agent)]",
                      group.isBranch && "italic",
                    )}
                  >
                    {group.title}
                  </span>
                </div>
                <div className="relative h-full flex-1 overflow-hidden">
                  <div
                    className="absolute top-[5px] h-[18px] rounded-sm bg-[var(--trace-agent)] opacity-40 transition-[filter] hover:brightness-125"
                    style={{
                      left: `${px(group.startSec)}%`,
                      width: `${Math.max(px(group.endSec) - px(group.startSec), 0.2)}%`,
                    }}
                  />
                </div>
              </div>
              {/* 逻辑行（Tool 归属于 LLM 调用，标签缩进一级；并行执行上下泳道堆叠） */}
              {group.rows.map((row) => (
                <div
                  key={row.key}
                  className="relative flex items-center"
                  style={{ height: 28 * row.laneCount }}
                >
                  <div
                    className={cn(
                      LABEL_W,
                      "flex h-full shrink-0 items-center justify-end gap-1.5 truncate text-[11px]",
                    )}
                    style={{ paddingRight: row.depth > 0 ? 30 : 12 }}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: spanColor(row.spans[0]) }}
                    />
                    <span
                      className={cn(
                        "truncate",
                        row.depth > 0 ? "text-muted-foreground/80" : "text-muted-foreground",
                      )}
                    >
                      {row.label}
                      {row.laneCount > 1 && (
                        <span className="ml-1 text-[9px] text-muted-foreground/60">
                          ×{row.laneCount} 并行
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="relative h-full flex-1 overflow-hidden">
                    {row.spans.map((s) => {
                      const left = px(s.relStart);
                      const width = Math.max(
                        px(s.relStart + s.timelineMs / 1000) - left,
                        0.2,
                      );
                      const failed = isFailed(s);
                      const lane = row.laneOf[s.id] ?? 0;
                      return (
                        <div
                          key={s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(s.id);
                          }}
                          className={cn(
                            "span-bar absolute cursor-pointer rounded-sm transition-[filter] hover:brightness-125",
                            selectedId === s.id &&
                              "z-[5] outline-2 outline-offset-1 outline-foreground",
                          )}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: 5 + lane * 28,
                            height: BAR_H,
                            background: spanColor(s),
                            ...(failed
                              ? { boxShadow: "inset 0 0 0 1px rgba(248,81,73,0.8)" }
                              : {}),
                          }}
                          title={`${s.name}\n${s.relStart.toFixed(1)}s → ${(s.relStart + s.timelineMs / 1000).toFixed(1)}s (${(s.timelineMs / 1000).toFixed(2)}s)${row.laneCount > 1 ? `\n并行泳道 ${(lane ?? 0) + 1}/${row.laneCount}` : ""}`}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无 Span 数据</p>
          )}
        </div>

        {/* 甘特图底部进度条：拖动平移甘特可视窗口 */}
        <div data-zoom-scope="gantt" className="mt-1.5 flex items-center">
          <div className={cn(LABEL_W, "shrink-0")} />
          <div className="flex-1">
            <DomainScrollbar domain={gEff} total={totalSeconds} onChange={setGanttDomain} />
          </div>
        </div>

        {/* 累计 Token（折线 + 堆叠柱）与 每次调用增量（构成堆叠柱），独立缩放域 */}
        <div data-zoom-scope="charts">
          <TokenCharts
            spans={spans}
            domain={chartDomain ?? { start: 0, end: totalSeconds }}
            zoomed={chartDomain !== null}
            totalSeconds={totalSeconds}
            onDomainChange={setChartDomain}
            onSelectCall={onSelectCall}
            highlightCallId={highlightCallId}
          />
        </div>
      </div>
    </div>
  );
}

// ==================== Canvas 图表 ====================

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function fmtTokShort(n: number): string {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

/** 等宽柱布局：可视域内的调用平均分槽位 */
interface Slot {
  call: CallInfo;
  cx: number; // 槽位中心 px
  cumBefore: number;
  cumAfter: number;
}

function TokenCharts({
  spans,
  domain,
  zoomed,
  totalSeconds,
  onDomainChange,
  onSelectCall,
  highlightCallId,
}: {
  spans: TraceSpan[];
  domain: Domain;
  zoomed: boolean;
  totalSeconds: number;
  onDomainChange: (d: Domain) => void;
  onSelectCall?: (callId: string, view: "cum" | "delta") => void;
  highlightCallId?: string | null;
}) {
  const lineRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const slotsRef = useRef<Slot[]>([]);

  const calls = useMemo(() => buildCalls(spans), [spans]);

  // 全局累计（跨所有调用，不随缩放变化）
  const cumAfter = useMemo(() => {
    let cum = 0;
    return calls.map((c) => {
      cum += c.total;
      return cum;
    });
  }, [calls]);

  // 可视域内的调用（按调用起点落在域内判定）
  const visible = useMemo(
    () =>
      calls
        .map((c, i) => ({ call: c, cumBefore: i > 0 ? cumAfter[i - 1] : 0, cumAfter: cumAfter[i] }))
        .filter(({ call }) => call.time >= domain.start - 0.001 && call.time <= domain.end + 0.001),
    [calls, cumAfter, domain],
  );

  // Round 分区：可视域内连续同 Round 的调用槽位区间
  const roundRanges = useMemo(() => {
    const ranges: Array<{ roundIndex: number; start: number; end: number }> = [];
    visible.forEach((v, i) => {
      const ri = v.call.roundIndex;
      const last = ranges[ranges.length - 1];
      if (last && last.roundIndex === ri) last.end = i;
      else ranges.push({ roundIndex: ri, start: i, end: i });
    });
    return ranges;
  }, [visible]);

  const setupCanvas = (canvas: HTMLCanvasElement, cssH: number) => {
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent?.clientWidth ?? 0;
    canvas.width = Math.max(cssW, 1) * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, cssW, cssH };
  };

  const fmtAxis = (v: number): string => {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (v >= 1000) return (v / 1000).toFixed(1) + "k";
    return String(Math.round(v));
  };

  /** 网格线：纵向铺满，横向对齐柱体缩放区 [top, bottom]，标签完整不裁切 */
  const drawGrid = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    maxVal: number,
    yDivisions: number,
    top: number,
    bottom: number,
  ) => {
    ctx.strokeStyle = cssVar("--chart-grid", "rgba(48,54,61,0.55)");
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i <= 10; i++) {
      const x = (w / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let i = 0; i <= yDivisions; i++) {
      const y = top + ((bottom - top) / yDivisions) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= yDivisions; i++) {
      const val = maxVal * (1 - i / yDivisions);
      const y = top + ((bottom - top) / yDivisions) * i;
      ctx.fillText(fmtAxis(val), 2, y);
    }
    ctx.textBaseline = "alphabetic";
  };

  const slotLayout = (w: number): Slot[] => {
    const n = visible.length;
    if (n === 0) return [];
    const slotW = w / n;
    return visible.map((v, i) => ({ ...v, cx: slotW * (i + 0.5) }));
  };

  /** Round 分区背景：交替底色 + 分隔线 + 顶部 Round 标签（slotW 为槽位宽） */
  const drawRoundBands = (
    ctx: CanvasRenderingContext2D,
    slotW: number,
    top: number,
    bottom: number,
  ) => {
    if (roundRanges.length === 0) return;
    const h0 = 4; // 槽位布局的整体左偏移（与柱体 x 偏移一致）
    roundRanges.forEach((r, i) => {
      const x0 = h0 + slotW * r.start;
      const w0 = slotW * (r.end - r.start + 1);
      // 交替底色
      if (i % 2 === 1) {
        ctx.globalAlpha = 0.06;
        ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
        ctx.fillRect(x0, top, w0, bottom - top);
        ctx.globalAlpha = 1;
      }
      // 分隔线（每段起点，首段除外）
      if (i > 0) {
        ctx.strokeStyle = cssVar("--chart-grid", "rgba(48,54,61,0.55)");
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, top);
        ctx.lineTo(x0, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 顶部 Round 标签（区间足够宽时）
      if (w0 > 44) {
        ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`Round ${r.roundIndex + 1}`, x0 + w0 / 2, 9);
      }
    });
    ctx.textAlign = "left";
  };

  const drawCum = useCallback(() => {
    const canvas = lineRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 140);
    if (!setup) return;
    const { ctx, cssW, cssH } = setup;
    const w = cssW;
    const h = cssH;
    const top = 18;
    const bottom = h - 8;
    const slots = slotLayout(w - 8);
    slotsRef.current = slots;
    const maxCum = Math.max(...slots.map((s) => s.cumAfter), 1);
    const scale = (v: number) => (v / maxCum) * (bottom - top);
    const barW = slots.length > 0 ? Math.min(Math.max(((w - 8) / slots.length) * 0.55, 6), 30) : 0;
    const baseY = bottom;
    const showNums = barW >= 12; // 柱宽足够时才绘制数字，避免全览时密集噪点

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    drawGrid(ctx, w, h, maxCum, 3, top, bottom);
    if (slots.length > 0) drawRoundBands(ctx, (w - 8) / slots.length, top, bottom);

    // 等宽堆叠柱：蓝 = 该次调用之前的累计，橙 = 本次新增
    const blueColor = cssVar("--chart-bar-in", "rgba(88,166,255,0.8)");
    const orangeColor = cssVar("--chart-new", "#f0883e");
    for (const s of slots) {
      const totalH = scale(s.cumAfter);
      const blueH = scale(s.cumBefore);
      const x = s.cx - barW / 2 + 4;
      if (totalH - blueH > 0) {
        ctx.fillStyle = orangeColor;
        ctx.fillRect(x, baseY - totalH, barW, totalH - blueH);
      }
      if (blueH > 0) {
        ctx.fillStyle = blueColor;
        ctx.fillRect(x, baseY - blueH, barW, blueH);
      }
      // 同步高亮：当前选中的调用柱描边标记
      if (highlightCallId && s.call.id === highlightCallId) {
        ctx.strokeStyle = cssVar("--foreground", "#e6edf3");
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1.5, baseY - totalH - 2, barW + 3, totalH + 4);
      }
      // 蓝色数字：原有累计（画在蓝色段内部）；橙色数字：本次新增（柱顶上方）
      if (!showNums) continue;
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      if (blueH > 13) {
        ctx.fillStyle = cssVar("--background", "#0d1117");
        ctx.fillText(fmtTokShort(s.cumBefore), s.cx + 4, baseY - blueH + 11);
      }
      if (totalH - blueH > 0) {
        ctx.fillStyle = orangeColor;
        ctx.fillText(`+${fmtTokShort(s.cumAfter - s.cumBefore)}`, s.cx + 4, baseY - totalH - 4);
      }
    }

    // 累计折线（贯穿柱顶）
    if (slots.length > 0) {
      ctx.beginPath();
      slots.forEach((s, i) => {
        const y = baseY - scale(s.cumAfter);
        if (i === 0) ctx.moveTo(s.cx + 4, y);
        else ctx.lineTo(s.cx + 4, y);
      });
      ctx.strokeStyle = cssVar("--chart-line", "#58a6ff");
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }, [visible, roundRanges, highlightCallId]);

  const drawDelta = useCallback(() => {
    const canvas = barRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 120);
    if (!setup) return;
    const { ctx, cssW, cssH } = setup;
    const w = cssW;
    const h = cssH;
    const top = 18;
    const bottom = h - 8;
    const slots = slotLayout(w - 8);
    const maxTotal = Math.max(...slots.map((s) => s.call.total), 1);
    const scale = (v: number) => (v / maxTotal) * (bottom - top);
    const barW = slots.length > 0 ? Math.min(Math.max(((w - 8) / slots.length) * 0.55, 6), 30) : 0;
    const baseY = bottom;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    drawGrid(ctx, w, h, maxTotal, 3, top, bottom);
    if (slots.length > 0) drawRoundBands(ctx, (w - 8) / slots.length, top, bottom);

    // 每次调用新增构成：自下而上堆叠（高对比配色）
    for (const s of slots) {
      let yCursor = baseY;
      const x = s.cx - barW / 2 + 4;
      for (const part of s.call.parts) {
        const segH = scale(part.value);
        if (segH <= 0) continue;
        ctx.fillStyle = cssVar(part.colorVar, "#8b949e");
        ctx.fillRect(x, yCursor - segH, barW, segH);
        yCursor -= segH;
      }
      // 同步高亮：当前选中的调用柱描边标记
      if (highlightCallId && s.call.id === highlightCallId) {
        ctx.strokeStyle = cssVar("--foreground", "#e6edf3");
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 1.5, yCursor - 2, barW + 3, baseY - yCursor + 4);
      }
      // 总数标注在柱顶上方（柱宽足够时才绘制，避免全览时密集噪点）
      if (baseY - yCursor > 0 && barW >= 12) {
        ctx.fillStyle = cssVar("--foreground", "#e6edf3");
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(fmtTokShort(s.call.total), s.cx + 4, Math.max(yCursor - 4, 12));
      }
    }
    ctx.restore();
  }, [visible, roundRanges, highlightCallId]);

  const drawAll = useCallback(() => {
    drawCum();
    drawDelta();
  }, [drawCum, drawDelta]);

  useEffect(() => {
    drawAll();
    const wrap = lineRef.current?.parentElement?.parentElement;
    let ro: ResizeObserver | null = null;
    if (wrap && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(drawAll);
      ro.observe(wrap);
    }
    // 主题切换时重绘（颜色来自 CSS 变量）
    const mo = new MutationObserver(drawAll);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      ro?.disconnect();
      mo.disconnect();
    };
  }, [drawAll]);

  /** 点击柱体：按槽位定位调用，通知右栏展示构成明细 */
  const slotIndexFromEvent = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const canvas = e.currentTarget;
    const w = canvas.clientWidth - 8;
    const n = slotsRef.current.length;
    if (n === 0) return -1;
    const slotW = w / n;
    const i = Math.floor(e.nativeEvent.offsetX / slotW);
    return i >= 0 && i < n ? i : -1;
  };

  const handleCumClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = slotIndexFromEvent(e);
    if (i >= 0) onSelectCall?.(slotsRef.current[i].call.id, "cum");
  };

  const handleDeltaClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const i = slotIndexFromEvent(e);
    if (i >= 0) onSelectCall?.(slotsRef.current[i].call.id, "delta");
  };

  const legendSwatch = (colorVar: string, label: string, title?: string) => (
    <span key={label} className="flex items-center gap-1 whitespace-nowrap" title={title}>
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: `var(${colorVar})` }}
      />
      {label}
    </span>
  );

  return (
    <>
      {/* 累计 Token：折线 + 等宽堆叠柱（蓝 = 原有累计 / 橙 = 本次新增），柱区全宽 */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="relative flex items-center justify-end">
          <div className="absolute left-1 flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">累计 Token</span>
            {zoomed && (
              <span className="text-[9px] text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            )}
          </div>
          <div className="flex items-center gap-3 pr-2 text-[10px] text-muted-foreground">
            {legendSwatch("--chart-bar-in", "原有累计")}
            {legendSwatch("--chart-new", "本次新增")}
            <span className="hidden sm:inline">点击柱体查看构成 · 折线为累计走势</span>
          </div>
        </div>
        <div className="relative" data-zoom-track="1">
          <canvas
            ref={lineRef}
            className="block cursor-pointer"
            onClick={handleCumClick}
          />
        </div>
        {/* 折线图底部进度条 */}
        <div className="mt-1.5">
          <DomainScrollbar domain={domain} total={totalSeconds} onChange={onDomainChange} />
        </div>
      </div>

      {/* 每次调用 Token 增量：构成堆叠柱（等宽），柱区全宽 */}
      <div className="mt-3 border-t border-border pb-1 pt-3">
        <div className="relative flex items-center justify-end">
          <div className="absolute left-1 flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">每次调用增量</span>
            {zoomed && (
              <span className="text-[9px] text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 pr-2 text-[10px] text-muted-foreground">
            {legendSwatch("--call-assistant", "assistant", "上一轮模型输出（含 tool_calls）作为本轮输入被重新消费")}
            {legendSwatch("--call-tool", "tool 结果", "两次调用之间各工具的执行结果（按字符估算）")}
            {legendSwatch("--call-user", "用户输入", "本轮用户提问（估算）")}
            {legendSwatch("--call-sys", "系统提示", "本轮注入的 System Prompt（估算）")}
            {legendSwatch("--call-tooldefs", "工具定义", "请求携带的工具/Schema 定义（按采集字符数估算；未采集到时并入其他）")}
            {legendSwatch("--call-cache", "缓存读（命中）", "命中提示缓存的输入 Token：与之前重复的前缀直接复用、无需重新计算；是每次调用的大头。真实值")}
            {legendSwatch("--call-cachewrite", "缓存写（新建）", "新写入提示缓存的输入 Token：新拼入上下文的内容，供后续调用命中。真实值")}
            {legendSwatch("--call-other", "其他", "无法归类到上述成分的剩余输入（残差兜底）")}
            {legendSwatch("--call-output", "本次输出", "本次调用模型生成的输出（含 tool_calls）。真实值")}
          </div>
        </div>
        <div className="relative" data-zoom-track="1">
          <canvas
            ref={barRef}
            className="block cursor-pointer"
            onClick={handleDeltaClick}
          />
        </div>
        {/* 柱状图底部进度条 */}
        <div className="mt-1.5">
          <DomainScrollbar domain={domain} total={totalSeconds} onChange={onDomainChange} />
        </div>
      </div>
    </>
  );
}

// ==================== 可拖动进度条（可视窗口指示） ====================

function DomainScrollbar({
  domain,
  total,
  onChange,
}: {
  domain: Domain;
  total: number;
  onChange: (d: Domain) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const grabRef = useRef(0);

  const span = Math.max(domain.end - domain.start, 0.001);
  const full = Math.max(total, span, 0.001);
  const leftPct = Math.min(Math.max((domain.start / full) * 100, 0), 100);
  const widthPct = Math.min(Math.max((span / full) * 100, 1.5), 100);

  const timeAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * full;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const t = timeAt(e.clientX);
    const onThumb = !!(e.target as HTMLElement).closest?.("[data-thumb]");
    if (onThumb) {
      grabRef.current = t - domain.start;
    } else {
      // 点击空白处：窗口居中跳转到点击位置，并继续拖动
      const ns = Math.min(Math.max(t - span / 2, 0), Math.max(full - span, 0));
      grabRef.current = t - ns;
      onChange({ start: ns, end: ns + span });
    }
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const t = timeAt(e.clientX);
    const ns = Math.min(Math.max(t - grabRef.current, 0), Math.max(full - span, 0));
    if (ns !== domain.start) onChange({ start: ns, end: ns + span });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="relative h-3 cursor-pointer rounded-full bg-muted/50 hover:bg-muted/70"
      title="拖动平移时间轴"
    >
      <div
        data-thumb="1"
        className="absolute top-0 h-full rounded-full bg-primary/40 transition-colors hover:bg-primary/60"
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      />
    </div>
  );
}
