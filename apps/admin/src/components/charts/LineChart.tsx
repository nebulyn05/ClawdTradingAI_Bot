"use client";

import { useMemo, useRef, useState } from "react";
import { INK, CHART_SURFACE, formatChartValue, type ChartValueFormat } from "./tokens";

export interface LineSeries {
  name: string;
  color: string;
  points: number[]; // one value per label, same length as `labels`
}

interface LineChartProps {
  /** Pre-formatted display strings (e.g. "Jul 15") — format on the server before passing in, not via a function prop. */
  labels: string[];
  series: LineSeries[];
  height?: number;
  valueFormat?: ChartValueFormat;
}

const VIEW_W = 640;
const PAD_L = 44;
const PAD_R = 48; // room for the permanent end-of-line value label (marks-and-anatomy.md: "Lines -> value at the end")
const PAD_T = 12;
const PAD_B = 24;

/**
 * A thin-line chart with a crosshair + one-tooltip-every-series hover layer,
 * per the dataviz skill's line-chart spec: 2px lines, round caps, an 8px+
 * end-dot with a 2px surface ring, hairline recessive gridlines, a legend
 * whenever there's more than one series (never color-only identity).
 */
export function LineChart({ labels, series, height = 220, valueFormat = "integer" }: LineChartProps) {
  const formatValue = (v: number) => formatChartValue(v, valueFormat);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const allValues = series.flatMap((s) => s.points);
  const maxValue = Math.max(1, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const xFor = (i: number) => PAD_L + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * plotW);
  const yFor = (v: number) => {
    const range = maxValue - minValue || 1;
    return PAD_T + plotH - ((v - minValue) / range) * plotH;
  };

  const paths = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        d: s.points.map((v, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" "),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, labels.length, maxValue, minValue],
  );

  const yTicks = [minValue, (minValue + maxValue) / 2, maxValue];

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || labels.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const fracX = (e.clientX - rect.left) / rect.width;
    const xInView = fracX * VIEW_W;
    const idx = Math.round(((xInView - PAD_L) / plotW) * (labels.length - 1));
    setHoverIndex(Math.max(0, Math.min(labels.length - 1, idx)));
  }

  const hoverPx = hoverIndex !== null ? (xFor(hoverIndex) / VIEW_W) * 100 : null;

  return (
    <div className="relative">
      {series.length > 1 ? (
        <div className="mb-2 flex flex-wrap gap-3">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-xs text-white/60">
              <span className="inline-block h-[2px] w-4" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${height}`}
        className="w-full"
        style={{ height }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={yFor(t)} y2={yFor(t)} stroke={INK.gridline} strokeWidth={1} />
            <text x={PAD_L - 8} y={yFor(t)} fontSize={10} fill={INK.muted} textAnchor="end" dominantBaseline="middle">
              {formatValue(t)}
            </text>
          </g>
        ))}
        <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={height - PAD_B} stroke={INK.axis} strokeWidth={1} />

        {hoverIndex !== null ? (
          <line
            x1={xFor(hoverIndex)}
            x2={xFor(hoverIndex)}
            y1={PAD_T}
            y2={height - PAD_B}
            stroke={INK.axis}
            strokeWidth={1}
          />
        ) : null}

        {paths.map((s) => (
          <path key={s.name} d={s.d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {hoverIndex !== null
          ? series.map((s) => (
              <circle
                key={s.name}
                cx={xFor(hoverIndex)}
                cy={yFor(s.points[hoverIndex] ?? 0)}
                r={4}
                fill={s.color}
                stroke={CHART_SURFACE}
                strokeWidth={2}
              />
            ))
          : null}

        {/* Permanent end-of-line marker + value label (marks-and-anatomy.md: "Lines -> value at the end") — reachable without hovering. */}
        {labels.length > 0
          ? series.map((s) => {
              const lastValue = s.points[s.points.length - 1] ?? 0;
              const cx = xFor(labels.length - 1);
              const cy = yFor(lastValue);
              return (
                <g key={`end-${s.name}`}>
                  <circle cx={cx} cy={cy} r={4} fill={s.color} stroke={CHART_SURFACE} strokeWidth={2} />
                  <text x={cx + 8} y={cy} fontSize={11} fontWeight={600} fill={INK.primary} dominantBaseline="middle">
                    {formatValue(lastValue)}
                  </text>
                </g>
              );
            })
          : null}

        {labels.length > 0 ? (
          <>
            <text x={PAD_L} y={height - 6} fontSize={10} fill={INK.muted}>
              {labels[0]}
            </text>
            <text x={VIEW_W - PAD_R} y={height - 6} fontSize={10} fill={INK.muted} textAnchor="end">
              {labels[labels.length - 1]}
            </text>
          </>
        ) : null}
      </svg>

      {hoverIndex !== null && hoverPx !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-border bg-panel px-3 py-2 text-xs shadow-lg"
          style={{ left: `${hoverPx}%` }}
        >
          <div className="mb-1 text-white/50">{labels[hoverIndex]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="inline-block h-[2px] w-3" style={{ backgroundColor: s.color }} />
              <span className="font-semibold text-white">{formatValue(s.points[hoverIndex] ?? 0)}</span>
              <span className="text-white/50">{s.name}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
