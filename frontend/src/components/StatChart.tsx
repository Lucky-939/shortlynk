"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { HourlyBucket } from "@/lib/api";

interface StatChartProps {
  data: HourlyBucket[];
}

/** Formats "2025-06-15T13" → "13:00" for the X-axis label */
function formatHour(key: string): string {
  try {
    return `${key.slice(11)}:00`;
  } catch {
    return key;
  }
}

const EMPTY_HOURS: HourlyBucket[] = Array.from({ length: 24 }, (_, i) => ({
  hour: `hour-${i}`,
  count: 0,
}));

/**
 * StatChart — hourly click bar chart using recharts.
 * Gracefully handles an all-zero or empty data set with a placeholder.
 * Accent-coloured bars, minimal axis styling to match the terminal aesthetic.
 */
export default function StatChart({ data }: StatChartProps) {
  const hasData = data.some((d) => d.count > 0);

  // Merge real data into a full 24-slot array sorted chronologically
  const chartData = hasData
    ? [...data].sort((a, b) => a.hour.localeCompare(b.hour))
    : EMPTY_HOURS;

  return (
    <div className="relative">
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-muted text-sm">No clicks recorded yet</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 0, left: -28, bottom: 0 }}
          barCategoryGap="30%"
        >
          <XAxis
            dataKey="hour"
            tickFormatter={formatHour}
            tick={{ fill: "var(--color-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
            interval={5}
          />
          <YAxis
            tick={{ fill: "var(--color-muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "var(--color-raised)" }}
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 0,
              color: "var(--color-text)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
            labelFormatter={(label) =>
              typeof label === "string" && label.length >= 13
                ? `${label.slice(11)}:00 UTC`
                : String(label)
            }
            formatter={(value) => [Number(value), "clicks"]}
          />
          <Bar dataKey="count" maxBarSize={24}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  entry.count > 0
                    ? "var(--color-accent)"
                    : "var(--color-raised)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
