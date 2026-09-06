"use client";

import { useState, type ReactNode } from "react";

interface ChartWithTableProps {
  chart: ReactNode;
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Wraps a chart with a chart/table toggle — the anti-patterns list is
 * explicit that a tooltip must never be the only way to read a value, and
 * every chart needs a table-view twin. The table is the same data the
 * chart plots, not a separate query, so the two can never disagree.
 */
export function ChartWithTable({ chart, columns, rows }: ChartWithTableProps) {
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <div>
      <div className="mb-2 flex justify-end gap-1">
        <button
          type="button"
          onClick={() => setView("chart")}
          className={`rounded-lg px-2 py-1 text-xs font-medium ${
            view === "chart" ? "bg-accent text-white" : "bg-white/10 text-white/60 hover:bg-white/20"
          }`}
        >
          Chart
        </button>
        <button
          type="button"
          onClick={() => setView("table")}
          className={`rounded-lg px-2 py-1 text-xs font-medium ${
            view === "table" ? "bg-accent text-white" : "bg-white/10 text-white/60 hover:bg-white/20"
          }`}
        >
          Table
        </button>
      </div>

      {view === "chart" ? (
        chart
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
