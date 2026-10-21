"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Cell,
} from "recharts";
import { useChartColors, useCategoryPalette } from "@/lib/use-chart-colors";

/**
 * 横向条形图（升级版）：
 * - 每根柱子独立颜色（分类色板）+ 同色渐变 + 圆角
 * - 条尾数值标注
 * - Y 轴只显示名称（不带 emoji）
 */
export function FancyBarChartH({
  data,
  valueFormatter,
  ariaLabel,
  yAxisInterval,
}: {
  data: { name: string; value: number }[];
  valueFormatter: (v: number) => string;
  ariaLabel?: string;
  /**
   * Y 轴类目标签的显示间隔。recharts 默认自动抽稀，卡片较矮时会隔一个漏一个，
   * 看起来像"某几根柱子没有名字"。行数固定且不多时传 0 强制全显示。
   */
  yAxisInterval?: number;
}) {
  const colors = useChartColors();
  const palette = useCategoryPalette();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: colors.text }} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: colors.text }}
          axisLine={false}
          tickLine={false}
          width={160}
          interval={yAxisInterval}
        />
        <Tooltip
          cursor={{ fill: colors.grid, opacity: 0.4 }}
          contentStyle={{
            backgroundColor: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            fontSize: "12px",
            color: colors.text,
          }}
          formatter={(value) => [valueFormatter(value as number), ariaLabel ?? "数值"]}
        />
        <Bar
          dataKey="value"
          radius={[0, 3, 3, 0]}
          barSize={14}
          fillOpacity={0.85}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={palette[i % palette.length]} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v) => valueFormatter(Number(v))}
            style={{ fontSize: 11, fill: colors.text, fontWeight: 500 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
