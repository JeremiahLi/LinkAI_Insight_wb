"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useChartColors, useCategoryPalette } from "@/lib/use-chart-colors";

export interface MultiLineSeries {
  name: string;
  data: number[];
}

/**
 * 多序列趋势折线图：
 * - 默认所有曲线淡显
 * - 鼠标悬停图例项时，对应曲线高亮（不透明 + 加粗），其余更淡
 */
export function MultiLineTrendChart({
  labels,
  series,
  height = 220,
}: {
  labels: string[];
  series: MultiLineSeries[];
  height?: number;
}) {
  const colors = useChartColors();
  const palette = useCategoryPalette();
  // 当前悬停的序列名；null = 无悬停
  const [hovered, setHovered] = useState<string | null>(null);

  // 拼成行结构供 recharts 使用
  const rows = labels.map((label, i) => {
    const row: Record<string, number | string> = { label };
    for (const s of series) row[s.name] = s.data[i] ?? 0;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          width={40}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12px",
            color: colors.text,
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, cursor: "default" }}
          onMouseEnter={(payload) => {
            const item = payload as { dataKey?: string | number; value?: string | number };
            setHovered(String(item.dataKey ?? item.value ?? ""));
          }}
          onMouseLeave={() => setHovered(null)}
        />
        {series.map((s, i) => {
          const isHovered = hovered === s.name;
          return (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={palette[i % palette.length]}
              strokeWidth={isHovered ? 2.5 : 2}
              strokeOpacity={hovered == null ? 0.4 : isHovered ? 1 : 0.12}
              dot={false}
              activeDot={isHovered ? { r: 4 } : { r: 0 }}
              legendType="plainline"
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
