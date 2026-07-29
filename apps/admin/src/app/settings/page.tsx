import { getDb } from "@clawd/db";
import { loadConfig } from "@clawd/core";
import { requireAdminSession } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { updateSettingAction } from "@/lib/actions";

const TUNABLE_KEYS = [
  { key: "TAKE_PROFIT_PCT", label: "Take-profit %", hint: "Fraction above entry, e.g. 0.5 = +50%" },
  { key: "STOP_LOSS_PCT", label: "Stop-loss %", hint: "Fraction below entry, e.g. 0.2 = -20%" },
  {
    key: "MAX_CONCURRENT_POSITIONS_PER_CHAIN",
    label: "Max concurrent positions / chain",
    hint: "Integer",
  },
  { key: "PROFIT_FEE_RATE", label: "Profit fee rate", hint: "Fraction, e.g. 0.02 = 2%" },
  { key: "SNIPER_ENABLED", label: "Sniper enabled", hint: "true / false" },
  { key: "SCOUT_ENABLED", label: "Scout enabled", hint: "true / false" },
  { key: "ARBITER_ENABLED", label: "Arbiter enabled (detection log)", hint: "true / false" },
] as const;

export default async function SettingsPage() {
  await requireAdminSession();
  const cfg = loadConfig();
  const overrides = await getDb().setting.findMany();
  const overrideMap = new Map(overrides.map((o) => [o.key, o.value]));

  const envDefaults: Record<string, string> = {
    TAKE_PROFIT_PCT: String(cfg.TAKE_PROFIT_PCT),
    STOP_LOSS_PCT: String(cfg.STOP_LOSS_PCT),
    MAX_CONCURRENT_POSITIONS_PER_CHAIN: String(cfg.MAX_CONCURRENT_POSITIONS_PER_CHAIN),
    PROFIT_FEE_RATE: String(cfg.PROFIT_FEE_RATE),
    SNIPER_ENABLED: "true",
    SCOUT_ENABLED: "true",
    ARBITER_ENABLED: "true",
  };

  return (
    <div>
      <Nav />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-lg font-semibold">Live Settings</h1>
        <p className="text-sm text-white/60">
          These override the .env defaults immediately, no restart needed. Clear the field and save
          to fall back to the env value again.
        </p>
        <div className="card divide-y divide-border">
          {TUNABLE_KEYS.map(({ key, label, hint }) => {
            const override = overrideMap.get(key);
            const effective = override ?? envDefaults[key];
            return (
              <div key={key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-white/40">{hint}</div>
                  <div className="text-xs text-white/50">
                    Effective: <span className="font-mono">{effective}</span>
                    {override ? "" : " (env default)"}
                  </div>
                </div>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    await updateSettingAction(key, String(formData.get("value") ?? ""));
                  }}
                  className="flex items-center gap-2"
                >
                  <input name="value" defaultValue={override ?? ""} placeholder={envDefaults[key]} className="input w-32" />
                  <button type="submit" className="btn btn-secondary">
                    Save
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
