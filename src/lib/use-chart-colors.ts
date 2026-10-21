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
