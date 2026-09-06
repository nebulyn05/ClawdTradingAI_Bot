import { loginFormAction } from "@/lib/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <form action={loginFormAction} className="card w-full max-w-sm space-y-4">
        <div>
          <div className="text-2xl">🦞</div>
          <h1 className="text-lg font-semibold">Clawd Agents</h1>
          <p className="text-xs text-white/50">Admin dashboard</p>
        </div>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <div>
          <label className="mb-1 block text-xs text-white/60">Username</label>
          <input name="username" className="input" autoComplete="username" required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/60">Password</label>
          <input name="password" type="password" className="input" autoComplete="current-password" required />
        </div>
        <button type="submit" className="btn btn-primary w-full">
          Log in
        </button>
      </form>
    </div>
  );
}
