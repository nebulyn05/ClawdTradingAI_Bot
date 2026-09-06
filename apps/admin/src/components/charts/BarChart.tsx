"use client";

import { useState } from "react";
import { INK, formatChartValue, type ChartValueFormat } from "./tokens";

export interface BarSeries {
  name: string;
  color: string;
  values: number[]; // one value per label, same length as `labels`
}

interface BarChartProps {
  /** Pre-formatted display strings (e.g. "Jul 15") — format on the server before passing in, not via a function prop. */
  labels: string[];
  series: BarSeries[];
  height?: number;
  valueFormat?: ChartValueFormat;
}

const VIEW_W = 640;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;
const GROUP_GAP = 8; // between label groups
const BAR_GAP = 2; // surface gap between touching bars in a group
const MAX_BAR_W = 24;

/**
 * Grouped bar chart per the dataviz skill's spec: bars capped at 24px thick,
 * 4px rounded data-end / square baseline, a 2px surface gap between touching
 * bars, and per-bar hover (the mark itself is the hit target — no crosshair,
 * unlike a line chart).
 */
export function BarChart({ labels, series, height = 220, valueFormat = "integer" }: BarChartProps) {
  const formatValue = (v: number) => formatChartValue(v, valueFormat);
  const [hover, setHover] = useState<{ label: number; series: number } | null>(null);

  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;
  const groupW = labels.length > 0 ? plotW / labels.length : plotW;
  // Gaps scale down with the group width instead of staying fixed — at high
  // label density (e.g. a 90-day range) a flat 8px GROUP_GAP can exceed the
  // entire group width and drive bar width negative. barW always floors at
  // 1px so bars stay visible (touching, if the chart is dense) rather than
  // disappearing.
  const groupGap = Math.min(GROUP_GAP, groupW * 0.2);
  const barGap = series.length > 1 ? Math.min(BAR_GAP, groupW * 0.05) : 0;
  const barW = Math.max(
    1,
    Math.min(MAX_BAR_W, (groupW - groupGap - barGap * (series.length - 1)) / Math.max(1, series.length)),
  );

  const yFor = (v: number) => PAD_T + plotH - (v / maxValue) * plotH;
  const yTicks = [0, maxValue / 2, maxValue];

  return (
    <div className="relative">
      {series.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-3">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-xs text-white/60">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <svg viewBox={`0 0 ${VIEW_W} ${height}`} className="w-full" style={{ height }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={yFor(t)} y2={yFor(t)} stroke={INK.gridline} strokeWidth={1} />
            <text x={PAD_L - 8} y={yFor(t)} fontSize={10} fill={INK.muted} textAnchor="end" dominantBaseline="middle">
              {formatValue(t)}
            </text>
          </g>
        ))}
        <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={height - PAD_B} y2={height - PAD_B} stroke={INK.axis} strokeWidth={1} />

        {labels.map((label, li) => {
          const groupX = PAD_L + li * groupW + (groupW - (barW * series.length + barGap * (series.length - 1))) / 2;
          return (
            <g key={label}>
              {series.map((s, si) => {
                const v = s.values[li] ?? 0;
                const barH = Math.max(0, (v / maxValue) * plotH);
                const x = groupX + si * (barW + barGap);
                const y = height - PAD_B - barH;
                const isHover = hover?.label === li && hover?.series === si;
                return (
                  <rect
                    key={s.name}
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={s.color}
                    opacity={isHover ? 1 : 0.85}
                    onMouseEnter={() => setHover({ label: li, series: si })}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
              <text
                x={PAD_L + li * groupW + groupW / 2}
                y={height - 6}
                fontSize={10}
                fill={INK.muted}
                textAnchor="middle"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      {hover ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((PAD_L + hover.label * groupW + groupW / 2) / VIEW_W) * 100}%` }}
        >
          <div className="mb-1 text-white/50">{labels[hover.label]}</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: series[hover.series]!.color }} />
            <span className="font-semibold text-white">{formatValue(series[hover.series]!.values[hover.label] ?? 0)}</span>
            <span className="text-white/50">{series[hover.series]!.name}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
