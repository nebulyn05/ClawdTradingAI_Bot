import Link from "next/link";
import { formatNativeAmount } from "@clawd/chains";
import type { SignalSource } from "@clawd/core";
import { getPerformanceReport, PERFORMANCE_WINDOWS, type ChainPerformance } from "@/lib/performance";

const SOURCES: SignalSource[] = ["sniper", "scout", "arbiter", "manual", "admin_rule"];

function isSignalSource(value: string | undefined): value is SignalSource {
  return SOURCES.includes(value as SignalSource);
}

function PerformanceTable({ windowDays, rows }: { windowDays: number; rows: ChainPerformance[] }) {
  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-3 text-sm font-semibold text-white/80">Last {windowDays} days</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-white/50">No trades in this window.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Chain</th>
              <th>Trades</th>
              <th>Win rate</th>
              <th>Avg win</th>
              <th>Avg loss</th>
              <th>Volume</th>
              <th>Max drawdown</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.chain}>
                <td className="capitalize">{r.chain}</td>
                <td>{r.trades}</td>
                <td>{(r.winRate * 100).toFixed(1)}%</td>
                <td>{formatNativeAmount(r.chain, BigInt(r.avgWinRaw))}</td>
                <td>{formatNativeAmount(r.chain, BigInt(r.avgLossRaw))}</td>
                <td>{formatNativeAmount(r.chain, BigInt(r.volumeRaw))}</td>
                <td>{(r.maxDrawdownPct * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const { source: rawSource } = await searchParams;
  const source = isSignalSource(rawSource) ? rawSource : undefined;

  const reports = await Promise.all(PERFORMANCE_WINDOWS.map((w) => getPerformanceReport(w, source)));

  return (
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Performance</h1>
        <p className="text-sm text-white/50">
          Broken out by chain — native units (SOL, ETH, BNB, …) aren&rsquo;t combined across chains.
          This is the same query that would back a bot-facing performance command later.
        </p>

        <div className="flex flex-wrap gap-2">
          <Link href="/performance" className={`btn ${!source ? "btn-secondary" : ""}`}>
            All sources
          </Link>
          {SOURCES.map((s) => (
            <Link key={s} href={`/performance?source=${s}`} className={`btn ${source === s ? "btn-secondary" : ""}`}>
              {s}
            </Link>
          ))}
        </div>

        {reports.map((report) => (
          <PerformanceTable key={report.windowDays} windowDays={report.windowDays} rows={report.byChain} />
        ))}
      </main>
  );
}
