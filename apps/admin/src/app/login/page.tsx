import { loginFormAction } from "@/lib/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[110px]" />
      <form action={loginFormAction} className="relative w-full max-w-md space-y-6 rounded-3xl border border-border bg-panel/85 p-6 shadow-[0_30px_80px_-35px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-3xl shadow-[0_0_40px_rgba(139,92,246,0.15)]">🦞</div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Clawd Agents</h1>
          <p className="mt-1 text-sm text-white/45">Secure administration console</p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-400/15 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">{error}</div>
        ) : null}

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/60">Username</label>
            <input name="username" className="input" autoComplete="username" placeholder="Enter admin username" required />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/60">Password</label>
            <input name="password" type="password" className="input" autoComplete="current-password" placeholder="Enter password" required />
          </div>
        </div>

        <button type="submit" className="btn btn-primary w-full py-2.5">Sign in to Admin</button>
        <p className="text-center text-[10px] leading-relaxed text-white/25">Authorized personnel only · Activity is audited</p>
      </form>
    </div>
  );
}
