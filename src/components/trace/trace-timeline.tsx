"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildGroups,
  buildTokenSeries,
  isFailed,
  spanColor,
  type SpanGroup,
  type TraceSpan,
} from "./trace-helpers";

const LABEL_W = "w-48"; // 标签列宽度：时间轴 / 甘特图 / 两个图表严格共用，保证纵向对齐
const BAR_H = 18;

interface Props {
  spans: TraceSpan[];
  totalSeconds: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface Domain {
  start: number;
  end: number;
}

export function TraceTimeline({ spans, totalSeconds, selectedId, onSelect }: Props) {
  const groups = useMemo(() => buildGroups(spans), [spans]);

  // 缩放域（秒）：null = 全量。甘特图 / 折线图 / 柱状图共用，滚轮缩放联动。
  const [domain, setDomain] = useState<Domain | null>(null);
  const effDomain = domain ?? { start: 0, end: totalSeconds };
  const domainRef = useRef(effDomain);
  domainRef.current = effDomain;
  const axisTrackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 会话切换时复位缩放
  useEffect(() => {
    setDomain(null);
  }, [spans]);

  // 滚轮缩放：以鼠标位置为锚点，非 passive 监听以便阻止默认滚动
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
      const d = domainRef.current;
      const span0 = Math.max(d.end - d.start, 0.001);
      const factor = Math.exp(e.deltaY * 0.0012); // 向下滚 = 缩小（zoom out）
      const minSpan = Math.max(totalSeconds / 2000, 0.05);
      const newSpan = Math.min(Math.max(span0 * factor, minSpan), totalSeconds);
      const rect = axisTrackRef.current?.getBoundingClientRect();
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
      setDomain({ start: ns, end: ne });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [totalSeconds]);

  const spanSec = effDomain.end - effDomain.start;
  const px = useCallback(
    (t: number) => ((t - effDomain.start) / Math.max(spanSec, 0.001)) * 100,
    [effDomain, spanSec],
  );
  const fmtTick = useCallback(
    (t: number) => {
      if (spanSec <= 10) return `${t.toFixed(1)}s`;
      if (t < 60) return `${t.toFixed(0)}s`;
      return `${(t / 60).toFixed(1)}m`;
    },
    [spanSec],
  );
  const ticks = Array.from({ length: 6 }, (_, i) => effDomain.start + (spanSec * i) / 5);

  /** 双击某个 Round / Branch：以该组起止为左右边界聚焦时间轴 */
  const focusGroup = useCallback(
    (g: SpanGroup) => {
      const pad = Math.max((g.endSec - g.startSec) * 0.08, 0.5);
      setDomain({
        start: Math.max(0, g.startSec - pad),
        end: Math.min(totalSeconds, g.endSec + pad),
      });
    },
    [totalSeconds],
  );

  return (
    <div
      ref={scrollRef}
      onDoubleClick={() => setDomain(null)}
      className="flex-1 overflow-auto scrollbar-thin"
      title="滚轮缩放（甘特图 / 折线图 / 柱状图联动）· 双击空白复位 · 双击 Round 聚焦"
    >
      <div className="relative min-w-[860px] p-4 pb-3">
        {/* 时间轴（甘特图与图表共用同一缩放域） */}
        <div className="mb-1.5 flex items-center text-[11px] text-muted-foreground">
          <div className={cn(LABEL_W, "shrink-0 pr-3 text-right")}>
            {domain ? (
              <span className="text-[var(--trace-llm)]">已缩放 · 双击复位</span>
            ) : (
              <span className="text-[10px]">已剔除轮间空闲</span>
            )}
          </div>
          <div ref={axisTrackRef} className="flex flex-1">
            {ticks.map((t, i) => (
              <div key={i} className={cn("flex-1", i === ticks.length - 1 && "text-right")}>
                {fmtTick(t)}
              </div>
            ))}
          </div>
        </div>

        {/* 甘特行：Round / Branch 分组框 */}
        <div className="timeline-grid relative">
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
              {/* 逻辑行 */}
              {group.rows.map((row) => (
                <div key={row.key} className="relative flex h-7 items-center">
                  <div
                    className={cn(
                      LABEL_W,
                      "flex shrink-0 items-center justify-end gap-1.5 truncate pr-3 text-[11px]",
                    )}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: spanColor(row.spans[0]) }}
                    />
                    <span className="truncate text-muted-foreground">{row.label}</span>
                  </div>
                  <div className="relative h-full flex-1 overflow-hidden">
                    {row.spans.map((s) => {
                      const left = px(s.relStart);
                      const width = Math.max(
                        px(s.relStart + s.timelineMs / 1000) - left,
                        0.2,
                      );
                      const failed = isFailed(s);
                      return (
                        <div
                          key={s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(s.id);
                          }}
                          className={cn(
                            "span-bar absolute top-[5px] cursor-pointer rounded-sm transition-[filter] hover:brightness-125",
                            selectedId === s.id &&
                              "z-[5] outline-2 outline-offset-1 outline-foreground",
                          )}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            height: BAR_H,
                            background: spanColor(s),
                            ...(failed
                              ? { boxShadow: "inset 0 0 0 1px rgba(248,81,73,0.8)" }
                              : {}),
                          }}
                          title={`${s.name}\n${s.relStart.toFixed(1)}s → ${(s.relStart + s.timelineMs / 1000).toFixed(1)}s (${(s.timelineMs / 1000).toFixed(2)}s)`}
                        >
                          {s.tokens && width > 3 && (
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-0.5 font-mono text-[9px] text-white/90">
                              <span style={{ opacity: 0.85 }}>{fmtTokShort(s.tokens.input)}</span>
                              <span style={{ opacity: 0.5 }}>/</span>
                              <span style={{ opacity: 0.85 }}>{fmtTokShort(s.tokens.output)}</span>
                            </span>
                          )}
                        </div>
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

        {/* 甘特图底部进度条：拖动平移可视窗口 */}
        <div className="mt-1.5 flex items-center">
          <div className={cn(LABEL_W, "shrink-0")} />
          <div className="flex-1">
            <DomainScrollbar domain={effDomain} total={totalSeconds} onChange={setDomain} />
          </div>
        </div>

        {/* 累计 Token 折线图 + 每次调用增量柱状图（与甘特图共用缩放域） */}
        <TokenCharts
          spans={spans}
          domain={effDomain}
          totalSeconds={totalSeconds}
          onDomainChange={setDomain}
        />
      </div>
    </div>
  );
}

function fmtTokShort(n: number): string {
  if (n == null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

// ==================== Canvas 图表 ====================

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function TokenCharts({
  spans,
  domain,
  totalSeconds,
  onDomainChange,
}: {
  spans: TraceSpan[];
  domain: Domain;
  totalSeconds: number;
  onDomainChange: (d: Domain) => void;
}) {
  const lineRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const lineTipRef = useRef<HTMLDivElement>(null);
  const barTipRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string>("");

  const { points, events } = useMemo(
    () => buildTokenSeries(spans, domain.end),
    [spans, domain.end],
  );

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

  const domainSpan = Math.max(domain.end - domain.start, 0.001);

  const drawLine = useCallback(() => {
    const canvas = lineRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 120);
    if (!setup) return;
    const { ctx, cssW, cssH } = setup;
    const maxCum = Math.max(...points.map((p) => p.cum), 1);
    const w = cssW;
    const h = cssH;
    const tx = (t: number) => ((t - domain.start) / domainSpan) * w;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    // 裁剪到可视域，缩放时域外的点不越界绘制
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    // 垂直网格（与甘特图 10% 刻度一致）
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
    for (let i = 0; i <= 3; i++) {
      const y = (h / 3) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Y 标签
    ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    for (let i = 0; i <= 3; i++) {
      const val = maxCum * (1 - i / 3);
      const y = (h / 3) * i;
      ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + "k" : String(Math.round(val)), 2, y + 3);
    }

    const lineColor = cssVar("--chart-line", "#58a6ff");

    // area
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = tx(p.time);
      const y = h - (p.cum / maxCum) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = cssVar("--chart-line-fill", "rgba(88,166,255,0.14)");
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = tx(p.time);
      const y = h - (p.cum / maxCum) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // dots（仅画可视域内）
    ctx.fillStyle = lineColor;
    ctx.strokeStyle = cssVar("--background", "#0d1117");
    ctx.lineWidth = 1.5;
    for (const p of points) {
      if (!("id" in p)) continue;
      const x = tx(p.time);
      if (x < -4 || x > w + 4) continue;
      const y = h - (p.cum / maxCum) * h;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }, [points, domain, domainSpan]);

  const drawBar = useCallback(() => {
    const canvas = barRef.current;
    if (!canvas || !canvas.parentElement?.clientWidth) return;
    const setup = setupCanvas(canvas, 100);
    if (!setup) return;
    const { ctx, cssW, cssH } = setup;
    const maxAdd = Math.max(...events.map((e) => e.add), 1);
    const w = cssW;
    const h = cssH;
    const tx = (t: number) => ((t - domain.start) / domainSpan) * w;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    // 垂直网格（与甘特图对齐）
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
    ctx.setLineDash([]);

    // Y 标签
    ctx.fillStyle = cssVar("--muted-foreground", "#8b949e");
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    [0, 0.5, 1].forEach((r) => {
      const val = maxAdd * (1 - r);
      ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + "k" : String(Math.round(val)), 2, h * r + 3);
    });

    // 堆叠柱：下半截输入侧（Input + Cache，蓝）、上半截 Output（绿）
    for (const e of events) {
      const xCenter = tx(e.start + e.duration / 2);
      const barW = Math.max((e.duration / domainSpan) * w, 8);
      if (xCenter + barW / 2 < 0 || xCenter - barW / 2 > w) continue;
      const totalH = (e.add / maxAdd) * h;
      const inSide = e.in + e.cache;
      const inH = e.add > 0 ? (inSide / e.add) * totalH : 0;
      const outH = totalH - inH;
      const x = xCenter - barW / 2;
      const baseY = h;

      if (inH > 0) {
        ctx.fillStyle = cssVar("--chart-bar-in", "rgba(88,166,255,0.8)");
        ctx.fillRect(x, baseY - inH, barW, inH);
      }
      if (outH > 0) {
        ctx.fillStyle = cssVar("--chart-bar-out", "rgba(63,185,80,0.8)");
        ctx.fillRect(x, baseY - totalH, barW, outH);
      }
      if (totalH > 14 && xCenter >= 0 && xCenter <= w) {
        ctx.fillStyle = cssVar("--foreground", "#e6edf3");
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(fmtTokShort(e.add), xCenter, baseY - totalH - 3);
      }
    }
    // 图例移至标题行（HTML 绘制），画布内不再绘制
    ctx.restore();
  }, [events, domain, domainSpan]);

  const drawAll = useCallback(() => {
    drawLine();
    drawBar();
  }, [drawLine, drawBar]);

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

  const hideTip = (el: HTMLDivElement | null) => el?.classList.add("hidden");

  const handleLineHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = lineRef.current;
    const tip = lineTipRef.current;
    if (!canvas || !tip) return;
    const w = canvas.clientWidth;
    const t = domain.start + (e.nativeEvent.offsetX / w) * domainSpan;
    if (t < domain.start || t > domain.end) {
      hideTip(tip);
      setHint("");
      return;
    }
    let nearest = points[0];
    let minDist = Infinity;
    for (const p of points) {
      const d = Math.abs(p.time - t);
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    tip.classList.remove("hidden");
    tip.style.left = `${Math.min(Math.max((nearest.time - domain.start) / domainSpan, 0), 1) * w}px`;
    tip.style.transform = "translateX(-50%)";
    tip.textContent =
      "id" in nearest
        ? `${nearest.time.toFixed(1)}s · +${nearest.add} (in ${nearest.in}/out ${nearest.out}) → 累计 ${nearest.cum.toLocaleString()}`
        : `${nearest.time.toFixed(1)}s · 累计 ${nearest.cum.toLocaleString()}`;
    setHint(tip.textContent);
  };

  const handleBarHover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = barRef.current;
    const tip = barTipRef.current;
    if (!canvas || !tip) return;
    const w = canvas.clientWidth;
    const t = domain.start + (e.nativeEvent.offsetX / w) * domainSpan;
    let nearest = null;
    let minDist = Infinity;
    for (const ev of events) {
      const mid = ev.start + ev.duration / 2;
      const d = Math.abs(mid - t);
      if (d < minDist) {
        minDist = d;
        nearest = ev;
      }
    }
    if (!nearest || minDist > domainSpan * 0.02) {
      hideTip(tip);
      setHint("");
      return;
    }
    tip.classList.remove("hidden");
    tip.style.left = `${Math.min(Math.max((nearest.start + nearest.duration / 2 - domain.start) / domainSpan, 0), 1) * w}px`;
    tip.style.transform = "translateX(-50%)";
    tip.textContent = `${nearest.name} @ ${nearest.time.toFixed(1)}s · In ${nearest.in}${nearest.cache > 0 ? ` + Cache ${nearest.cache}` : ""} + Out ${nearest.out} = ${nearest.add}`;
    setHint(tip.textContent);
  };

  return (
    <>
      {/* 累计 Token 折线图 */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="relative mb-1 flex items-center justify-center">
          <span className="text-xs font-medium text-muted-foreground">累计 Token</span>
          <span className="absolute right-0 truncate text-[11px] text-muted-foreground">
            {hint || "悬停查看详情"}
          </span>
        </div>
        <div className="flex">
          <div className={cn(LABEL_W, "shrink-0")} />
          <div className="relative flex-1">
            <canvas
              ref={lineRef}
              className="block"
              onMouseMove={handleLineHover}
              onMouseLeave={() => {
                hideTip(lineTipRef.current);
                setHint("");
              }}
            />
            <div
              ref={lineTipRef}
              className="pointer-events-none absolute top-1 z-20 hidden rounded border border-border bg-popover px-2 py-1 font-mono text-xs shadow-lg"
            />
          </div>
        </div>
        {/* 折线图底部进度条 */}
        <div className="mt-1.5 flex items-center">
          <div className={cn(LABEL_W, "shrink-0")} />
          <div className="flex-1">
            <DomainScrollbar domain={domain} total={totalSeconds} onChange={onDomainChange} />
          </div>
        </div>
      </div>

      {/* 每次调用 Token 增量柱状图 */}
      <div className="mt-3 border-t border-border pb-1 pt-3">
        <div className="relative mb-1 flex items-center justify-center">
          <span className="text-xs font-medium text-muted-foreground">每次调用增量</span>
          <span className="absolute right-0 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-bar-in)]" />
              输入侧（含 Cache）
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-bar-out)]" />
              Output
            </span>
          </span>
        </div>
        <div className="flex">
          <div className={cn(LABEL_W, "shrink-0")} />
          <div className="relative flex-1">
            <canvas
              ref={barRef}
              className="block"
              onMouseMove={handleBarHover}
              onMouseLeave={() => hideTip(barTipRef.current)}
            />
            <div
              ref={barTipRef}
              className="pointer-events-none absolute top-1 z-20 hidden rounded border border-border bg-popover px-2 py-1 font-mono text-xs shadow-lg"
            />
          </div>
        </div>
        {/* 柱状图底部进度条 */}
        <div className="mt-1.5 flex items-center">
          <div className={cn(LABEL_W, "shrink-0")} />
          <div className="flex-1">
            <DomainScrollbar domain={domain} total={totalSeconds} onChange={onDomainChange} />
          </div>
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
