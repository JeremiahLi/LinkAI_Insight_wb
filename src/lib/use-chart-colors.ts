"use client";

import { useState, useEffect } from "react";

export function useIsDark() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

const LIGHT_COLORS = {
  text: "oklch(0.18 0.02 260)",
  grid: "oklch(0.91 0.008 260 / 65%)",
  areaStroke: "oklch(0.45 0.12 250)",
  areaFill: "oklch(0.45 0.12 250 / 25%)",
  /** 中性基准线（如「累计」类参考序列），压过一眼不与主色争 */
  neutralLine: "oklch(0.62 0.02 260)",
  bars: [
    "oklch(0.48 0.11 255)",
    "oklch(0.55 0.10 250)",
    "oklch(0.62 0.09 245)",
    "oklch(0.68 0.08 240)",
    "oklch(0.74 0.06 235)",
  ],
};

const DARK_COLORS = {
  text: "oklch(0.96 0.005 260)",
  grid: "oklch(1 0 0 / 10%)",
  areaStroke: "oklch(0.68 0.10 250)",
  areaFill: "oklch(0.68 0.10 250 / 25%)",
  neutralLine: "oklch(0.74 0.02 260)",
  bars: [
    "oklch(0.65 0.10 255)",
    "oklch(0.70 0.09 250)",
    "oklch(0.75 0.08 245)",
    "oklch(0.80 0.07 240)",
    "oklch(0.85 0.05 235)",
  ],
};

/** 分类色板：跨色相，用于多色柱状图/多序列折线（区分不同 Agent/用户） */
const LIGHT_PALETTE = [
  "#3b82f6", // 蓝
  "#8b5cf6", // 紫
  "#10b981", // 绿
  "#f59e0b", // 琥珀
  "#ef4444", // 红
  "#06b6d4", // 青
  "#ec4899", // 粉
  "#84cc16", // 黄绿
];

const DARK_PALETTE = [
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#22d3ee",
  "#f472b6",
  "#a3e635",
];

export function useChartColors() {
  const isDark = useIsDark();
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}

export function useCategoryPalette(): string[] {
  const isDark = useIsDark();
  return isDark ? DARK_PALETTE : LIGHT_PALETTE;
}

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const offset = l - c / 2;
  const to = (v: number) =>
    Math.round((v + offset) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

/**
 * 把 hex 颜色降饱和（saturation 乘以 keep），色相与明度不变。
 * 用于把默认分类色板（Tailwind 500 系）压柔一点，适合大面积柱形填充；
 * 只改饱和度，保证同一实体跨图仍然同色、图例可辨识。
 */
export function softenColor(hex: string, keep = 0.7): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const [h, s, l] = hexToHsl(hex);
  if (s === 0) return hex;
  return hslToHex(h, s * keep, l);
}

/**
 * 指标身份色：颜色用来标识「这是哪个指标卡」，而不是「这是卡里哪条序列」。
 * 卡内多序列用同色族梯度 / 线型 / 语义红区分，跨卡不再撞色。
 */
export type MetricAccent = {
  /** 图表主色（stroke / 柱填充） */
  solid: string;
  /** 图标块底色（浅色主题下为极浅同色系，深色下为低透明度同色） */
  tint: string;
  /** 图标描边色，保证在 tint 上有足够对比 */
  ink: string;
  /** 多段堆叠用的同色相梯度（首段最突出）；只有需要分段的指标才有 */
  ramp?: [string, string, string];
};

export type MetricKey = "users" | "sessions" | "tokens" | "agents";

const LIGHT_ACCENTS: Record<MetricKey, MetricAccent> = {
  users: { solid: "#3b82f6", tint: "#dbeafe", ink: "#1d4ed8" },
  sessions: { solid: "#8b5cf6", tint: "#ede9fe", ink: "#6d28d9" },
  tokens: {
    solid: "#f59e0b",
    tint: "#fef3c7",
    ink: "#b45309",
    ramp: ["#b45309", "#f59e0b", "#fcd34d"],
  },
  agents: { solid: "#06b6d4", tint: "#cffafe", ink: "#0e7490" },
};

const DARK_ACCENTS: Record<MetricKey, MetricAccent> = {
  users: { solid: "#60a5fa", tint: "rgb(96 165 250 / 15%)", ink: "#93c5fd" },
  sessions: { solid: "#a78bfa", tint: "rgb(167 139 250 / 15%)", ink: "#c4b5fd" },
  tokens: {
    solid: "#fbbf24",
    tint: "rgb(251 191 36 / 15%)",
    ink: "#fcd34d",
    ramp: ["#fde68a", "#fbbf24", "#c2410c"],
  },
  agents: { solid: "#22d3ee", tint: "rgb(34 211 238 / 15%)", ink: "#67e8f9" },
};

export function useMetricAccents(): Record<MetricKey, MetricAccent> {
  const isDark = useIsDark();
  return isDark ? DARK_ACCENTS : LIGHT_ACCENTS;
}

/**
 * 会话终态语义色：与 OutcomeBadge 的 success / warning / destructive 同源。
 * 只用于图表（散点/堆叠柱），语义固定为「成功 / 部分成功 / 失败」，不要挪作他用。
 */
export type OutcomeKey = "success" | "partial" | "failed" | "unknown";

const LIGHT_OUTCOME: Record<OutcomeKey, string> = {
  success: "oklch(0.6 0.15 155)",
  partial: "oklch(0.72 0.16 70)",
  failed: "oklch(0.58 0.22 25)",
  unknown: "oklch(0.62 0.02 260)",
};

const DARK_OUTCOME: Record<OutcomeKey, string> = {
  success: "#3fb950",
  partial: "#d29922",
  failed: "#f85149",
  unknown: "#8b949e",
};

export function useOutcomePalette(): Record<OutcomeKey, string> {
  const isDark = useIsDark();
  return isDark ? DARK_OUTCOME : LIGHT_OUTCOME;
}

/** 把后端 outcome 字符串收敛成四个绘图键（truncated 暂并入 failed，与 successRateOf 口径一致） */
export function normalizeOutcome(outcome: string, status?: string): OutcomeKey {
  if (outcome === "success" || outcome === "partial" || outcome === "failed") return outcome;
  if (outcome === "truncated") return "failed";
  if (status === "active") return "unknown";
  return "unknown";
}
