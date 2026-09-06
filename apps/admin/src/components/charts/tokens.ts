/**
 * Dark-mode-only chart tokens (this admin app has no light theme — see
 * globals.css's fixed `color-scheme: dark`). Categorical hues + chart chrome
 * are the dataviz skill's reference palette, validated against this app's
 * actual card surface (#14101f, not the skill's generic #1a1a19 default) via
 * `validate_palette.js --mode dark --surface "#14101f"` — all checks pass
 * (worst adjacent CVD ΔE 8.4, worst normal-vision ΔE 19.3, all ≥3:1 contrast).
 */
export const CHART_SURFACE = "#14101f";

export const CATEGORICAL = [
  "#3987e5", // 1 blue
  "#d95926", // 2 orange
  "#199e70", // 3 aqua
  "#c98500", // 4 yellow
  "#d55181", // 5 magenta
  "#008300", // 6 green
  "#9085e9", // 7 violet
  "#e66767", // 8 red
] as const;

export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export const INK = {
  primary: "#ffffff",
  secondary: "#c3c2b7",
  muted: "#898781",
  gridline: "#2c2c2a",
  axis: "#383835",
};

export type ChartValueFormat = "integer" | "percent";

/**
 * A serializable string enum instead of a formatter function — chart
 * components are client components ("use client"), and functions can't be
 * passed as props from a Server Component across that boundary. Labels
 * should be pre-formatted into display strings by the caller before being
 * passed to `labels`, for the same reason.
 */
export function formatChartValue(v: number, format: ChartValueFormat = "integer"): string {
  return format === "percent" ? `${Math.round(v)}%` : String(Math.round(v));
}
