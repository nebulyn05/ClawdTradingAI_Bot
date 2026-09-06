import Link from "next/link";
import { getUserGrowth, getTradeActivity, getUnifiedActivity, ACTIVITY_TYPES, type ActivityType } from "@/lib/analytics";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { ChartWithTable } from "@/components/charts/ChartWithTable";
import { CATEGORICAL } from "@/components/charts/tokens";

const DAY_RANGES = [7, 30, 90] as const;

const TYPE_LABEL: Record<ActivityType, string> = {
  trade: "Trades",
  rule: "Rule firings",
  admin: "Admin actions",
  key_reveal: "Key reveals",
  signup: "Signups",
};

const TYPE_ICON: Record<ActivityType, string> = {
  trade: "💱",
  rule: "⚙️",
  admin: "🛠️",
  key_reveal: "🔑",
  signup: "🆕",
};

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; type?: string }>;
}) {
  const params = await searchParams;
  const days = DAY_RANGES.includes(Number(params.days) as (typeof DAY_RANGES)[number])
    ? Number(params.days)
    : 30;
  const typeFilter = ACTIVITY_TYPES.includes(params.type as ActivityType) ? (params.type as ActivityType) : undefined;

  const [growth, trades, activity] = await Promise.all([
    getUserGrowth(days),
    getTradeActivity(days),
    getUnifiedActivity(200),
  ]);

  const filteredActivity = typeFilter ? activity.filter((a) => a.type === typeFilter) : activity;

  return (
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Activity</h1>
            <p className="text-sm text-white/60">Trends and a unified feed of everything happening across the platform.</p>
          </div>
          <div className="flex gap-1">
            {DAY_RANGES.map((d) => (
              <Link
                key={d}
                href={`/activity?days=${d}${typeFilter ? `&type=${typeFilter}` : ""}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  d === days ? "bg-accent text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                {d}d
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-white/80">User growth (cumulative)</h2>
            <ChartWithTable
              chart={
                <LineChart
                  labels={growth.labels.map(formatDay)}
                  series={[{ name: "Users", color: CATEGORICAL[0], points: growth.cumulative }]}
                />
              }
              columns={["Date", "Cumulative users"]}
              rows={growth.labels.map((l, i) => [formatDay(l), growth.cumulative[i] ?? 0])}
            />
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-semibold text-white/80">Trades per day</h2>
            <ChartWithTable
              chart={
                <BarChart
                  labels={trades.labels.map(formatDay)}
                  series={[
                    { name: "Buys", color: CATEGORICAL[0], values: trades.buys },
                    { name: "Sells", color: CATEGORICAL[1], values: trades.sells },
                  ]}
                />
              }
              columns={["Date", "Buys", "Sells"]}
              rows={trades.labels.map((l, i) => [formatDay(l), trades.buys[i] ?? 0, trades.sells[i] ?? 0])}
            />
          </div>

          <div className="card lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold text-white/80">Win rate among sell trades (%)</h2>
            <ChartWithTable
              chart={
                <LineChart
                  labels={trades.labels.map(formatDay)}
                  series={[{ name: "Win rate", color: CATEGORICAL[2], points: trades.winRate }]}
                  valueFormat="percent"
                />
              }
              columns={["Date", "Win rate %"]}
              rows={trades.labels.map((l, i) => [formatDay(l), `${Math.round(trades.winRate[i] ?? 0)}%`])}
            />
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Activity feed</h2>
            <div className="flex flex-wrap gap-1">
              <Link
                href={`/activity?days=${days}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  !typeFilter ? "bg-accent text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                All
              </Link>
              {ACTIVITY_TYPES.map((t) => (
                <Link
                  key={t}
                  href={`/activity?days=${days}&type=${t}`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    typeFilter === t ? "bg-accent text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
                  }`}
                >
                  {TYPE_ICON[t]} {TYPE_LABEL[t]}
                </Link>
              ))}
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Summary</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {filteredActivity.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap text-xs">{item.timestamp.toLocaleString()}</td>
                  <td className="text-xs">
                    {TYPE_ICON[item.type]} {TYPE_LABEL[item.type]}
                  </td>
                  <td className="text-sm">{item.summary}</td>
                  <td className="max-w-xs truncate text-xs text-white/50">{item.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredActivity.length === 0 ? <p className="text-white/50">Nothing here yet.</p> : null}
        </div>
      </main>
  );
}
