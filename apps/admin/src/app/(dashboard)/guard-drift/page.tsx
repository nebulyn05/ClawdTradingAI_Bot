import { getGuardDriftReport, type VersionAccuracy } from "@clawd/guard";

function AccuracyTable({ title, rows }: { title: string; rows: VersionAccuracy[] }) {
  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-3 text-sm font-semibold text-white/80">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-white/50">No closed, screened positions yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Closed positions</th>
              <th>Rugged</th>
              <th>Performed well</th>
              <th>Neutral</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.version}>
                <td className="font-mono text-xs">{r.version}</td>
                <td>{r.total}</td>
                <td>{r.rugged}</td>
                <td>{r.performedWell}</td>
                <td>{r.neutral}</td>
                <td>{(r.accuracy * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default async function GuardDriftPage() {
  const report = await getGuardDriftReport();
  const alerts = [...report.ruleVersionAlerts, ...report.aiPromptVersionAlerts];

  return (
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Guard decision drift</h1>
        <p className="text-sm text-white/50">
          Accuracy on the accepted population only — Guard rejections never become positions, so there&rsquo;s no
          price history to check a false rejection against. This measures how often a token Guard approved later
          turned out to be a rug.
        </p>

        {alerts.length > 0 ? (
          <div className="card border-red-500/40 bg-red-500/10">
            <h2 className="mb-2 text-sm font-semibold text-red-300">Drift alerts</h2>
            <ul className="space-y-1 text-sm text-red-200">
              {alerts.map((a) => (
                <li key={a.version}>
                  Version <span className="font-mono">{a.version}</span>: rolling accuracy{" "}
                  {(a.rollingAccuracy * 100).toFixed(1)}% is {(a.dropPct * 100).toFixed(1)} points below its{" "}
                  {(a.baselineAccuracy * 100).toFixed(1)}% baseline.
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <AccuracyTable title="Accuracy by mechanical rule version" rows={report.byRuleVersion} />
        <AccuracyTable title="Accuracy by AI prompt version" rows={report.byAiPromptVersion} />
      </main>
  );
}
