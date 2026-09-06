# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Clawd Agents — a multi-chain autonomous crypto trading bot on Telegram, plus
an operator admin dashboard. Users get a custodial wallet per chain
(generated, imported, or auto-detected from any common format inside the
bot); five specialist services (Sniper, Scout, Guard, Arbiter, Router) watch
for opportunities, screen them for safety, and trade automatically with auto
take-profit/stop-loss. A 2% fee is taken only on profitable closed trades and
can be swept on-chain to an admin-configured treasury address. The admin
dashboard is a full multi-user operator console: role-based accounts
(super_admin/operator/analyst), an audited private-key viewer, activity
analytics with charts, and per-user profile pages.

The marketing site is a **real Next.js app**, `apps/website` — see "The
marketing site (`apps/website`)" below. The repo also still keeps two
non-served static snapshots for reference/rollback, neither of which should
be built on further:
- `website-static-backup/` — an untouched, byte-for-byte mirror of the live
  `https://clawdagents.bot` static export, pulled directly from production.
  This is the ground-truth reference if `apps/website` content ever needs
  re-checking against the real site.
- `website/` — the same mirror with a manual splash-screen/opacity patch
  applied (a `<script>` safety-net forcing stuck CSS-reveal state to
  "shown" after a timeout), from before the Next.js rebuild existed. Superseded
  by `apps/website`; kept only in case something in the rebuild needs a
  quick visual diff against it.

**Every chain defaults to testnet/devnet.** Flipping any chain to mainnet is
a deliberate, per-chain env var change — never assume mainnet.

**Every chain defaults to testnet/devnet.** Flipping any chain to mainnet is
a deliberate, per-chain env var change — never assume mainnet.

## Commands

```bash
npm install                    # installs all workspaces
npm run build                  # tsc -b across every package/app (Next.js admin app builds separately via its own `next build`)
npm test                       # vitest run — all unit tests, once, across the workspace
npx vitest run <path>          # run a single test file, e.g. packages/specialists/router/src/tp-sl.test.ts
npm run lint                   # tsc -b --pretty (type-check everything, no separate ESLint config exists)

npm run db:generate            # prisma generate
npm run db:migrate             # prisma migrate dev (creates/applies migrations against DATABASE_URL)

npm run dev:bot                # apps/bot — Telegram bot process
npm run dev:worker             # apps/worker — trading pipeline process
npm run dev:admin              # apps/admin — Next.js dashboard (separate process, own build)
npm run dev:website            # apps/website — Next.js marketing site (separate process, own build), http://localhost:8080
npm run serve:website          # legacy static website/ snapshot at http://localhost:8080 (`serve`, not python's http.server — no Range-request support, breaks video) — reference only, not the live site

docker compose up -d           # local Postgres + Redis for development
```

There is no ESLint/Prettier config — `tsc -b`'s type-checking is the only
static gate. `strict: true` and `noUncheckedIndexedAccess: true` are on
project-wide (see `tsconfig.base.json`); array/object index access returns
`T | undefined`, so destructuring with a default (`const [a = "0", b = ""] =
str.split(".")`) is the established pattern, not optional chaining or `!`.

**Rebuilding after a fresh clone or a `tsconfig.tsbuildinfo` problem:** delete
stale build-info files before rebuilding — TypeScript project references
occasionally get a stuck incremental state:
```bash
rm -f packages/*/tsconfig.tsbuildinfo apps/bot/tsconfig.tsbuildinfo apps/worker/tsconfig.tsbuildinfo packages/specialists/*/tsconfig.tsbuildinfo
npx tsc -b
```

**Running one test in isolation:** most test files set required env vars
(`MASTER_ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`) in a `beforeAll` using
`process.env.X ??= ...`, and import the module under test with a dynamic
`await import(...)` inside each `it()` rather than a static top-level import
— this is required, not stylistic: every `@clawd/core` consumer calls
`loadConfig()` as an import-time side effect (via `createLogger` at module
scope), so a static import evaluates before the test's env vars are set and
throws "Invalid environment configuration." Follow the existing pattern in
any new test file.

**Admin app (`apps/admin`) is not part of the `tsc -b` project reference
graph** — it's a Next.js app with its own `tsconfig.json` (bundler
resolution, `noEmit`), built via `next build`/`next dev`, not `tsc`. It
imports the *compiled* output of `@clawd/core`, `@clawd/db`, `@clawd/chains`,
`@clawd/wallet`, `@clawd/router` — those must have been built (`npm run
build` or `tsc -b` at the root) before `next dev`/`next build` will resolve
them. Local aliased imports in this app use extensionless paths (`@/lib/auth`),
not the `.js`-suffixed NodeNext style used everywhere else in the repo.

**`apps/admin/next.config.mjs`'s `serverExternalPackages` list is load-bearing,
not incidental** — `pino`/`pino-pretty`/`thread-stream`, and `viem`/`ox`, are
in there because webpack-bundling them into the server chunk breaks a
relative/dynamic require each one does internally: `thread-stream` (pino's
transport worker, used by `packages/core/src/logger.ts`'s dev-mode
`pino-pretty` transport) locates its worker file via a path relative to its
own package directory, which webpack's bundle layout doesn't preserve —
this crashed *every* request in dev (`Cannot find module '.../vendor-chunks/
lib/worker.js'`, "the worker thread exited") until it was added here. `viem`/
`ox` avoid a separate, non-fatal but noisy issue: `viem/chains` has no
per-chain export subpath, so importing any single chain (as
`packages/chains/src/evm/config.ts` does) pulls in the whole barrel
including `tempo`, which drags in `ox`'s `virtualMasterPool.js` — an
expression-based dynamic require webpack can't statically analyze
("Critical dependency: the request of a dependency is an expression").
Removing any of these five from the list reintroduces one of those two
failure modes; if a future dependency does its own worker-thread spawning
or dynamic require and breaks the same way when bundled, add it here rather
than reworking the dependency itself.

## Architecture

```
apps/
  bot/        Telegram bot (grammY): onboarding, wallet management, notifications
  worker/     Background process: Sniper/Scout -> Guard -> Router pipeline, position monitor, Arbiter scan, rule engine
  admin/      Next.js operator dashboard — separate process, reads/writes the same Postgres directly (no API layer). Multi-user RBAC (super_admin/operator/analyst), analytics, per-user profiles — see "Admin dashboard" sections below
  website/    Next.js marketing site — separate process, no backend deps at all (no DB, no @clawd/* packages). Static-ish content rebuilt with real interactivity — see "The marketing site" below
packages/
  core/       Env config (zod), logger, in-process event bus + Redis bridge, runtime Setting overrides, shared domain types
  db/         Prisma schema (Postgres) + generated client
  wallet/     Keygen + envelope-encrypted custody (all 6 chains)
  chains/     ChainAdapter interface + implementations (solana/, evm/ — the evm/ family covers Ethereum, BSC, Base, Monad, Robinhood Chain), RPC failover (rpc-failover.ts, evm/transport.ts)
  pricing/    Birdeye, DexScreener, Pyth, Chainlink price-feed clients
  ai/         Anthropic client + prompts (Guard's qualitative gate, tweet interpretation, TP/SL reasoning) — all behind AI_FEATURES_ENABLED
  backtest/   Replays historical closed Position/Trade rows against a candidate Guard rule-set or sizing config — read-only, no live trades
  specialists/
    guard/    Safety screening (liquidity, mint/freeze authority, honeypot, holder concentration) + AI final gate + decision-drift detection (drift.ts, drift-report.ts)
    sniper/   New-launch/new-pair detection
    scout/    Smart-money wallet tracking + KOL/Twitter call interpretation
    arbiter/  Cross-chain price-spread detection (real LI.FI quotes) + EVM<->EVM bridge execution
    router/   Trade execution, auto TP/SL (+ periodic AI re-evaluation), position lifecycle, fee ledger, admin rule engine, portfolio exposure cap + dynamic (Kelly) sizing, drawdown circuit breaker
```

### Process boundaries and how they talk to each other

`bot`, `worker`, and `admin` are **three separate Node processes**. They
share one Postgres database and one `@clawd/core` event bus type surface,
but the event bus itself (`packages/core/src/event-bus.ts`) is a plain
in-process `EventEmitter` — it does **not** cross process boundaries. Since
the worker produces trade events the bot needs to relay to users, those
specific events (`router.positionOpened`, `router.positionClosed`,
`guard.rejected`) are re-published over Redis pub/sub
(`packages/core/src/redis-bridge.ts`): the worker calls
`startPublishingToRedis([...])`, the bot calls `startSubscribingToRedis([...])`
and re-emits locally. When adding a new cross-process notification, wire it
through this bridge — adding an `eventBus.on(...)` handler in the bot for an
event only the worker emits will silently never fire.

The admin app doesn't use the event bus at all; it reads/writes Postgres
directly via Server Components and Server Actions (`apps/admin/src/lib/actions.ts`).

### The ChainAdapter seam

Every specialist codes against `ChainAdapter` (`packages/chains/src/types.ts`)
— `getBalance`, `watchNewPairs`, `watchWallet`, `getQuote`, `executeSwap`,
`withdraw` — never against a specific chain's SDK directly. There are two
adapter families:

- **Solana** (`packages/chains/src/solana/`): Helius/devnet RPC, Pump.fun
  launch detection via log subscription (an account-key-position heuristic,
  not a full IDL decode — see the comment in `pumpfun.ts`), Jupiter for
  swap quotes/execution, optional Jito bundle submission for MEV protection.
- **EVM family** (`packages/chains/src/evm/`), parameterized by chain —
  covers Ethereum, BSC, Base, Monad, and Robinhood Chain identically. Monad
  and Robinhood Chain are **not stubs**; both are EVM-compatible and use
  viem's own bundled chain definitions (`viem/chains`' `monad`/`monadTestnet`/
  `robinhood`/`robinhoodTestnet` — verified directly against the installed
  package's compiled source, not guessed). Swap execution prefers a real
  1inch v6 aggregator quote on mainnet when `ONEINCH_API_KEY` is set,
  falling back to a direct Uniswap-V2-style router (works on testnets, where
  1inch has no liquidity) otherwise — see `evm/adapter.ts`'s `getQuote`/
  `executeSwap` dispatch logic. Live subscriptions use a websocket transport
  when available (`evm/watch.ts`'s `watchClient`), auto-derived from the
  configured RPC URL.

`getChainAdapter(chain)` (`packages/chains/src/registry.ts`) is the single
lazily-constructed, cached entry point every specialist uses — never
construct an adapter directly.

**RPC failover** is opt-in per chain/network via comma-separated
`*_RPC_FALLBACK_URLS` env vars (empty by default — no behavior change until
set). The two ecosystems use different mechanisms since they have
different native tooling: EVM (`evm/transport.ts`'s `createEvmTransport`)
uses viem's own `fallback()` transport, wrapping each URL in a logging
`http()` (`onFetchRequest`/`onFetchResponse`) so a degraded primary shows up
in logs; Solana (`solana/rpc.ts`) has no built-in equivalent, so
`rpc-failover.ts`'s generic `withRpcFailover` Proxy-wraps a list of
`Connection` instances, retrying only a fixed whitelist of one-shot request
methods (`getBalance`, `sendRawTransaction`, `confirmTransaction`, …) —
**not** subscription methods like `onLogs`, which are bound to one
connection's websocket and return a subscription id synchronously, not a
promise. `withRpcFailover` is generic over any same-shaped instance list
(tested against plain mock objects), not Solana-specific, if another
ecosystem without built-in failover needs the same treatment later.

New chain support means implementing `ChainAdapter`, registering it in
`registry.ts`, and — if it's EVM-compatible — very likely just adding a case
to `evm/config.ts`'s `evmConfig()` rather than writing a whole new adapter.

### The trading pipeline

Five independent signal sources feed one shared path, not five separate
pipelines:

```
Sniper (new pair)          \
Scout (smart-money buy)     |-> Guard.getOrScreenToken() -> Router.openPosition()
Scout (KOL tweet, via AI)  /
Arbiter (cross-chain spread) -> detection/logging only; no auto-trade orchestrator exists yet
```

`apps/worker/src/main.ts`'s `handleTradeCandidate()` is that shared path:
Guard screens (mechanical rules in `guard/src/rules.ts`, pure and unit
tested, plus an optional AI qualitative gate in `guard/src/score.ts` that
is the *final* say — a mechanical pass with an AI rejection is an overall
rejection), then every user with an `active` wallet on that chain gets
`Router.openPosition()` called for them independently. A signal is
per-chain/per-token, not per-user — the fan-out to users happens inside
`handleTradeCandidate`, not inside Router.

Router (`packages/specialists/router/src/`) splits pure math from I/O
deliberately — `tp-sl.ts` (take-profit/stop-loss price targets, fee
calculation) has zero DB/network calls and is fully unit tested; `open.ts`/
`close.ts`/`monitor.ts` orchestrate the actual chain calls and DB writes
around that math. Follow this split for new trading logic: pure calculation
in its own file with tests, I/O orchestration calls into it.

Profit/fee math is done in **raw bigint native units** (lamports/wei), not
floating point — a typical trade's wei amount exceeds `Number`'s safe-integer
range. `computeFeeRaw` in `tp-sl.ts` is the pattern (basis-points scaling to
keep the multiply exact); don't introduce a `Number()`-based profit
calculation on raw on-chain amounts.

`monitor.ts`'s position-monitor loop does two things per tick, in order: (1)
re-runs Guard on the position's token (cache-backed via `getOrScreenToken`,
so cheap most ticks) and closes immediately with `exitReason: "guard_exit"`
if a previously-safe token now fails; (2) only if still safe, checks the
deterministic TP/SL price trigger. An emerging rug risk overrides a TP/SL
target that hasn't hit yet.

**Known race condition, not yet fixed:** `closePosition` (`close.ts`) is
called from two different processes with no shared lock — the worker's
`monitor.ts` loop and the admin dashboard's `forceClosePositionAction`
(`apps/admin/src/lib/actions.ts`). Both read `position.status === "open"`
as a guard *before* executing the sell swap, then only write `status:
"closed"` *after* the swap confirms — so a monitor-loop close and an
admin force-close landing at the same moment can both pass the guard and
both attempt to sell the position's full `sizeAmountIn`. In practice this
is bounded rather than catastrophic: the second sell attempts to move
tokens the first swap already sold, which normally fails on-chain from
insufficient balance rather than double-executing. Fixing it properly
needs an atomic claim (e.g. an intermediate `PositionStatus` value written
via a conditional `updateMany` before the swap, not after) — that's a
schema change plus retry-path rework, deliberately not bolted on without
dedicated test coverage. Be aware of this if you touch `close.ts`,
`monitor.ts`, or `forceClosePositionAction`.

### Risk management: exposure cap, dynamic sizing, circuit breaker

`open.ts` runs three risk checks, in order, before `executeSwap` — each
follows the same pure-calc/I/O split as `tp-sl.ts`:

1. **Circuit breaker** (`circuit-breaker.ts` + `drawdown-check.ts`): a
   worker job computes realized-P&L drawdown per chain (bigint peak/trough,
   basis-point ratio — same exactness reasoning as `computeFeeRaw`) over a
   rolling window and flips the global `TRADING_PAUSED` Setting to `true` on
   a breach. `openPosition` rejects new trades while it's set; **existing**
   positions keep being monitored/closed normally. Only ever auto-set to
   `true` — clearing it back to `false` is a deliberate admin-dashboard
   action (Settings page), never automatic.
2. **Portfolio exposure cap** (`exposure.ts`): sums this user's open
   positions' current re-quoted value on this chain plus their uninvested
   balance into a "total portfolio value," and rejects a new position that
   would push exposure past `MAX_PORTFOLIO_EXPOSURE_PCT` of it.
   `maxAdditionalExposureRaw` computes the remaining headroom directly (not
   just approve/reject for one candidate size) so sizing can use it as a
   ceiling without a guess-and-check loop.
3. **Dynamic position sizing** (`sizing.ts`): fractional-Kelly sizing from
   each signal source's (`sniper`/`scout`/`arbiter`/`admin_rule`/`manual`)
   historical win rate and win/loss ratio (`computeCategoryStats`, derived
   from closed `Trade` rows, bigint basis-point ratio — never
   `Number(profitAmount)` on a wei-scale amount). Falls back to the wallet's
   flat `tradeSizeNative` when a category has fewer than
   `MIN_TRADES_FOR_SIZING` closed trades, or when wins/losses are one-sided
   (not enough data to trust a ratio) — never to zero, since "no data" isn't
   evidence of a bad edge. Negative expectancy (mechanical Kelly formula
   `f* = winRate - (1 - winRate) / avgWinLossRatio` at or below zero)
   rejects the trade (`sizeRaw: 0n`) instead. The final size is capped by
   both `MAX_POSITION_SIZE_PCT` and the exposure cap's headroom.
   `overrideSizeNative` (admin rule engine, manual trades) bypasses sizing
   entirely — an explicit size already carries intent — but the exposure
   cap still applies to it.

### Treasury fee sweep and arbitrary token transfers

`close.ts`'s `getTreasuryAddress(chain)` reads an admin-configured
`TREASURY_ADDRESS_<CHAIN>` Setting; if one is set, the 2% fee is swept
**on-chain**, right after the close transaction commits, from the user's own
wallet to that address (`adapter.withdraw`, same primitive Router already
uses for user withdrawals) — a real transfer, not just the `FeeLedger` row
that always gets written regardless. No address configured → fee stays in
the user's wallet, `FeeLedger` still records it. The sweep is deliberately
best-effort and wrapped in `try/catch`: a bad/malformed address or a failed
transfer must never undo or block the position close that already
succeeded. Because that failure mode is silent (a log line, not something an
operator necessarily sees), the admin dashboard's `updateSettingAction`
format-validates `TREASURY_ADDRESS_*` and `STABLECOIN_(USDC|USDT)_ADDRESS_*`
values at save time (EVM `0x` + 40 hex chars, Solana base58 32-44 chars)
rather than accepting anything and failing silently later.

`ChainAdapter` also exposes `getTokenBalance`/`transferToken` (ERC20 via
viem's built-in `erc20Abi` for EVM, `@solana/spl-token` for Solana,
auto-creating the recipient's associated token account if it doesn't exist
yet) — used by the bot's Wallet ▸ Transfer ▸ "Transfer Token" flow for an
arbitrary contract/mint address, and by "Transfer Currency" for
admin-configured stablecoins. Token amounts use `token-amount.ts`'s
`parseTokenAmount`/`formatTokenAmount` — the same string-based decimal math
as `native.ts`'s native-amount helpers, parameterized by the token's own
`decimals` instead of a fixed per-chain constant, for the same
never-use-floating-point-on-raw-amounts reason as `computeFeeRaw`.

### Backtesting and Guard decision drift

`packages/backtest/` replays closed `Position`/`Trade` rows (real ground
truth, never live trades) against a candidate Guard rule-set
(`GuardCandidateConfig`: score threshold + required checks) and/or sizing
config (`SizingCandidateConfig`), reusing `@clawd/router`'s own
`computeCategoryStats`/`computePositionSize` rather than re-implementing
Kelly math. `runBacktest`'s optional `split` (train/test date windows) is
what keeps a sizing config's validation out-of-sample: category stats are
derived only from the train window and applied blind to the test window, so
a config can't be judged on the same trades it was tuned on. Guard-filter
replay works from each token's **latest cached** `SafetyCheck` row as a
"what Guard would have seen" proxy — the schema doesn't retain a
point-in-time history of Guard results per token, so this is a documented
approximation, not an exact replay (same caveat applies to
`getGuardDriftReport` below).

`guard/src/drift.ts` + `drift-report.ts` track Guard's own real-world
accuracy: `SafetyCheck` rows now carry `ruleVersion`
(`guard/rules.ts`'s `GUARD_RULE_VERSION`, bump it when the mechanical
scoring changes) and `aiPromptVersion` (`ai/guard-review.ts`'s
`AI_GUARD_PROMPT_VERSION`, null when AI review didn't actually run — not
just when the disabled-AI stub ran). `getGuardDriftReport()` joins closed
positions back to the SafetyCheck row that approved them, classifies the
outcome (`guard_exit` → rugged, `take_profit` → performed well, anything
else → neutral), and computes accuracy (`1 - ruggedRate`) per version, over
a rolling window vs. its own baseline. This only measures the **accepted**
population — Guard rejections never become positions, so there's no price
history to check a false rejection against; it's a precision-style metric
("of what Guard let through, how often did it rug"), not full accuracy. A
worker job (`startDriftDetection`) logs a warning when rolling accuracy
drops more than `GUARD_DRIFT_ALERT_THRESHOLD_PCT` below baseline; the same
report backs the admin dashboard's `/guard-drift` page.

### Admin dashboard: authentication, roles, and layout

Three roles, ranked (`apps/admin/src/lib/roles.ts`'s `hasRole(current, min)`):
`analyst` (read-only everywhere) < `operator` (settings/rules/manual
trade/wallet pause-deploy) < `super_admin` (+ key reveal, user deletion,
admin-account management). `requireAdminSession(minRole = "analyst")`
(`apps/admin/src/lib/auth.ts`) is the one auth gate every protected page and
every write-side Server Action calls — it re-reads the admin's role from the
`AdminUser` table on every call rather than trusting the signed session
cookie (which only carries the username), so a role change or deactivation
takes effect on the very next request, not after the cookie happens to
expire. It's wrapped in React's `cache()` so the shared layout's default
call and a page's own stricter call (e.g. `requireAdminSession("super_admin")`
on `/admins`) dedupe to one DB lookup per request when the arguments match.

**Why `roles.ts` is a separate file from `auth.ts`:** `auth.ts` imports
`next/headers` (cookies) and Prisma, so it can only run in Server
Components/Actions. `Sidebar.tsx` is a client component (`usePathname()` for
active-route highlighting) that still needs `hasRole`/`AdminRole`/
`AdminSession` — importing them from `auth.ts` would drag `next/headers`
into the client bundle and fail to build ("You're importing a component
that needs next/headers"). `roles.ts` holds only the pure rank-comparison
logic and types; `auth.ts` re-exports them so every existing server-side
`import { requireAdminSession, hasRole } from "@/lib/auth"` keeps working
unchanged. Any new client component needing role logic imports from
`@/lib/roles` directly, never from `@/lib/auth`.

The old single-shared `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` env pair now
only bootstraps the **first** `AdminUser` row (as `super_admin`) the first
time anyone logs in against an empty table (`ensureBootstrapAdmin`) — so a
deployment that already had that pair configured doesn't get locked out when
the multi-user table shipped. Every login after that goes through
`AdminUser`, not the env pair; new admin accounts are created from the
`/admins` page (super_admin only).

Login is rate-limited at the account level: 5 consecutive wrong-password
attempts locks that `AdminUser` for 15 minutes (`failedLoginAttempts`/
`lockedUntil` columns, reset on success). `ADMIN_SESSION_SECRET` is checked
at first sign — if it's unset or under 32 characters, `session.ts` throws
rather than silently signing cookies with a weak/predictable HMAC key.

Every write action logs to `AdminAuditLog` via `logAdminAction(session,
action, target?, details?)` — `adminRole` is captured **at write time**, not
looked up later, so a subsequent role change never rewrites what actually
happened. This is the general activity trail; `KeyAccessLog` is a separate,
narrower, append-only table specifically for private-key reveals
(`revealPrivateKeyAction`, super_admin only) — the single most sensitive
action in the app, logged before the key is even decrypted, with no
delete/update path ever exposed for that model. Both feed the `/audit-log`
page.

**Layout**: every protected page lives under the `(dashboard)` route group
(`apps/admin/src/app/(dashboard)/`), whose `layout.tsx` calls
`requireAdminSession()` once and renders the `Sidebar` — individual pages no
longer call `requireAdminSession()` just to get a session for chrome
purposes, only when they need the `AdminSession` value for their own
stricter gate or role-conditional rendering (`canOperate`/`canManage`
booleans). `/login` sits outside the group, unauthenticated.

### Admin dashboard: Settings vs. Environment — what's live vs. boot-time

Two different pages for two different kinds of config, and the distinction
matters: `/settings` lists every `Setting`-table override the running
processes actually re-read live (see "Runtime-tunable settings vs. env
config" below) — editing one there has real, immediate effect. `/environment`
(`apps/admin/src/app/(dashboard)/environment/page.tsx`) is **read-only** —
RPC URLs, third-party API keys (masked), DEX contract addresses, MEV
endpoints, background-job intervals, network modes. These are all read once
at process boot (adapter construction, client instantiation) and cached for
the process's lifetime; changing them requires editing `.env` and
restarting the bot/worker, and the page says so explicitly rather than
implying they're editable. Don't add a Setting override for something whose
consuming code only reads `cfg.X` once at module/adapter-construction
time — either genuinely wire it through `getNumberSetting`/`getBooleanSetting`
first (see the arbiter/Jito/Flashbots/AI-enabled examples already wired this
way) or it belongs on the Environment page, not Settings.

### Admin dashboard: activity analytics and charts

`/activity` (`apps/admin/src/lib/analytics.ts`) has two things: time-series
charts (daily user growth, trade counts, win rate) and a unified activity
feed merging `Trade`, `RuleExecution`, `AdminAuditLog`, `KeyAccessLog`, and
new-user rows into one chronological, filterable timeline
(`getUnifiedActivity`, `ACTIVITY_TYPES`). Charts are hand-built SVG/React
components (`apps/admin/src/components/charts/`), not a charting library —
`LineChart`/`BarChart` follow the project's `dataviz` skill: a validated
8-slot categorical palette (`tokens.ts`'s `CATEGORICAL`, run through the
skill's contrast/CVD validator against this app's actual dark surface, not
assumed), thin marks, hover crosshair/tooltips, and a `ChartWithTable`
wrapper giving every chart a table-view twin so no value is ever
tooltip-only. **`BarChart`'s bar-width math scales gaps proportionally to
the available group width** (not a fixed pixel gap) — a fixed gap can
exceed the whole group width at high label density (a 90-day range is 90
grouped bars in a fixed-width chart) and drive bar width negative, silently
breaking the chart; if you touch this component, re-verify the width
calculation at all three day-range options, not just the default. Charts
receive pre-formatted **string** labels/values from the server component,
never function props — passing a function from a Server Component to a
Client Component doesn't serialize and breaks the build.

### Admin dashboard: user profile pages

`/users` is deliberately a thin, cheap list (one row per user, DB-only, no
live network calls) that links to `/users/[userId]`
(`apps/admin/src/lib/user-detail.ts`'s `getUserDetail`) for the expensive
per-user view: live on-chain balance per wallet (`getChainAdapter(chain)
.getBalance(address)`, best-effort with a 4s timeout — shows "unavailable,"
never a fabricated `0`, on failure), the shared-EVM-address badge, trading
settings, referrals, open positions, and recent trades. Keeping the list
page DB-only and pushing live-network reads to the detail page is
deliberate — fetching every user's balance on every list-page load doesn't
scale and isn't needed until an operator actually opens that user. The
Manual Trade page's multi-user checkbox list fires `openPosition` once per
selected user via `Promise.allSettled` (`apps/admin/src/lib/actions.ts`'s
`manualTradeAction`) — one user's duplicate-position/concurrency-cap
rejection doesn't block the others, and the audit log records
succeeded/failed counts.

### Admin dashboard: shared query functions, not inline page logic

Where a query is meant to be reused (by another admin page later, or
eventually a bot command showing the same numbers to end users), it lives
as a function in `apps/admin/src/lib/` rather than inline in the page
component — `apps/admin/src/lib/performance.ts`'s `getPerformanceReport`
(rolling win rate / avg win-loss / max drawdown / volume, broken out **per
chain** since native units don't combine across chains, by 7d/30d/90d
window and optional signal source) is the pattern to follow. It reuses
`@clawd/router`'s `computeDrawdown` rather than re-deriving the same
peak-to-trough math a third time.

### Runtime-tunable settings vs. env config

`loadConfig()` (`packages/core/src/config.ts`) is parsed once per process and
cached — it is **not** re-read at runtime. For values the admin dashboard
needs to change live without a restart (take-profit %, stop-loss %,
concurrency cap, fee rate, per-specialist enable/disable), there's a
separate DB-backed override layer: `getNumberSetting(key, fallback)` /
`getBooleanSetting(key, fallback)` (`packages/core/src/settings.ts`) check
the `Setting` table first and fall back to the env-configured value passed
in. Call sites (e.g. `router/src/open.ts`) read `cfg.TAKE_PROFIT_PCT` as the
fallback and pass it through `getNumberSetting`, never the raw config value
directly, wherever the dashboard is meant to be able to override it. See
"Admin dashboard: Settings vs. Environment" above for which admin page a new
config value belongs on.

### The admin rule engine reuses Router, it doesn't bypass it

`packages/specialists/router/src/rules-engine.ts` evaluates admin-defined
`Rule` rows (condition/action as JSON) against every user on a timer, and
fires the action through the same `openPosition()` every other signal source
uses (with `source: "admin_rule"`) — it inherits Router's existing
duplicate-position and concurrency-cap checks for free rather than
re-implementing them. Each `(rule, user)` pair fires at most once (checked
via a `RuleExecution` row), not once per tick. The admin dashboard's manual
trade action (`apps/admin/src/lib/actions.ts`) does the same thing directly
with `source: "manual"`.

### AI features are additive and default off

Everything in `packages/ai/` is gated by `isAiEnabled()` (needs both
`AI_FEATURES_ENABLED=true` and a real `ANTHROPIC_API_KEY`). Every call site
treats a disabled/failed AI call as a graceful default, and the *nature* of
that default differs by how the result is used:
- Guard's `reviewTokenWithAi` (a safety gate): disabled → approved (defers
  to the mechanical result that already ran); enabled-but-failed →
  **not approved** (fails safe/closed, since silently waving a trade through
  on an API error would defeat the point of the gate).
- Router's `reviewTpSlWithAi` (an optimization, not a gate): any failure
  mode → `null`, meaning "keep the current targets." There's nothing unsafe
  about leaving the existing percentage-based TP/SL in place.

Match whichever pattern fits when adding a new AI-backed decision — whether
failure should fail-closed or degrade-to-no-op depends on whether the AI
step is gating a risky action or refining one that already passed safety
checks.

### Cross-chain execution (Arbiter/LI.FI) — what's real vs. not

`packages/specialists/arbiter/src/lifi-quote.ts` gets real LI.FI quotes for
*any* of the 4 chains LI.FI covers (Solana included — its chain ID,
`1151111081099710`, was confirmed by reading the installed `@lifi/types`
package's compiled source directly, since this repo's network access to
LI.FI's docs is unreliable). `execute.ts`'s actual bridge **execution**
is EVM-to-EVM only — LI.FI's `TransactionRequest` type is EVM-shaped
(to/data/value/chainId) with no Solana transaction encoding, so a Solana leg
returns `null` with a log message rather than attempting something
unverified. There is also no orchestrator yet that picks a specific user's
wallets on both chains and runs a full buy → bridge → sell — the worker logs
`arbiter.opportunity` events rather than auto-trading them. If you're asked
to build that orchestrator, `execute.ts`'s `executeCrossChainArbitrage` is
the bridging primitive to call into, not something to re-implement.

### Custody

`packages/wallet/` does envelope encryption: a random per-wallet data key
encrypts the private key (AES-256-GCM), and that data key is itself wrapped
by `MASTER_ENCRYPTION_KEY` (`crypto.ts`). `withDecryptedKey(encryptedKey, fn)`
is the only sanctioned way to get plaintext key material into a signing
call — it scopes the decrypted value to one callback and is used by every
chain adapter's `executeSwap`/`withdraw`. Never add a code path that returns
a decrypted key from a function; `exportRawKey` is the named exception, and
it performs no auth itself, so any new caller must gate access before
calling it. There are exactly two sanctioned callers today: the bot's
passphrase-gated `/export` flow (`apps/bot/src/conversations/export-key.ts`,
end users revealing their own key) and the admin dashboard's
`revealPrivateKeyAction` (`apps/admin/src/lib/actions.ts`, an operator
revealing *any* user's key — super_admin-only, and every call writes a
`KeyAccessLog` row *before* decrypting, since this deliberately bypasses the
end-user passphrase flow entirely and the audit trail is the only
accountability left). This dual-access model was an explicit, deliberate
product decision, not an oversight — don't "fix" it by removing the admin
path.

The admin dashboard's session auth (`apps/admin/src/lib/auth.ts`,
`session.ts`) reuses this same package's `hashPassphrase`/`verifyPassphrase`
(scrypt-based) for admin login credentials, rather than introducing a second
hashing scheme.

### Bot: wallet import, the shared-EVM-address model, and transfers

Every user gets exactly **two** addresses, not six: one EVM keypair whose
address/key is duplicated across all 5 EVM chain `Wallet` rows (each row
independently envelope-encrypted — different IV/data-key per row, same
underlying key — so every existing per-chain lookup in
`open.ts`/`exposure.ts`/admin pages needed zero changes), plus one separate
Solana keypair. `createWalletsForOnboarding`/`regenerateWallet`
(`apps/bot/src/wallet-service.ts`) generate the EVM key material **once**
and reuse it across the 5 rows rather than generating per-chain.

Import (`/import`, `apps/bot/src/conversations/import-wallet.ts`) has no
"which chain?" prompt — `detectImportMaterial` (`packages/wallet/src/signer.ts`)
auto-detects the pasted secret's format: EVM 0x-hex → applies to all 5 EVM
rows; Solana base58 (Phantom) or JSON byte array (Solflare/Backpack) →
applies to the Solana row; a 12/15/18/21/24-word BIP39 mnemonic (all five
valid lengths, not just 12/24) → derives **both** an EVM key (`m/44'/60'/0'/0/0`,
`@scure/bip32`) and a Solana key (`m/44'/501'/0'/0'`, SLIP-0010 via
`micro-key-producer/slip10.js`, since standard BIP32 doesn't cover the
ed25519 curve) from the same phrase and replaces both. Whichever format,
existing rows are updated **in place** (never delete+recreate) so `Position.
walletId` — which has no delete cascade — keeps pointing at valid history.

Wallet ▸ Transfer offers two flows: "Transfer Currency" (native asset,
always; admin-configured stablecoins if `getStablecoinAddress` finds one —
see the treasury/token-transfer section above) and "Transfer Token" (any
ERC20/SPL address the user pastes). Both are multi-step
`@grammyjs/conversations` flows using `ctx.session.transferChain`/
`transferCurrency` to pass state into the conversation, since `.enter()`
takes no extra arguments — the same pattern `customValueEntryConversation`
and `customReferralCodeConversation` use for their own single-value entry
flows.

### Bot: Rewards Hub and referrals

`User.referralCode` (auto-derived from the user's id, or replaced with a
user-chosen one via `setCustomReferralCode` — validated format, unique,
Prisma `P2002` caught for a friendly "already taken" instead of a raw DB
error) and `User.referredByUserId` (first-attribution-wins, no self-referral)
are real and live. Cashback/referral **rates** shown on the Rewards Hub
(`CASHBACK_RATE_PCT`/`REFERRAL_COMMISSION_PCT` Settings, default 0 →
rendered as "not configured yet") are an admin business decision, not
something to hardcode — a reference competitor bot's screenshot showed fixed
20%/30% figures, but those are their marketing copy, not this product's
terms, so don't reintroduce them as literal constants. Unclaimed/claimed
dollar balances stay genuinely `$0` everywhere — no accrual ledger exists
yet, and showing a fabricated non-zero balance would be worse than an honest
"not live yet" placeholder.

### Bot: re-engagement nudges for non-activated users

`apps/bot/src/reengagement.ts`'s `startReengagementCheck` runs a recurring
check (`NUDGE_CHECK_INTERVAL_MS`, default 5 min) entirely inside the bot
process — unlike the worker's drawdown/drift jobs, its only work is a
Postgres read and a Telegram send, both already available in-process, so
there's no reason to round-trip through the worker→bot Redis bridge
(`packages/core/src/redis-bridge.ts`) for it.

**Eligibility** (`User` model, whole-account state — not per-`Wallet`, since
a user can hold up to 6 wallet rows but "activated" already means ANY of
them is active, the same test `menu.ts` uses): `alertsEnabled`, under
`NUDGE_MAX_COUNT` (default 5) total nudges, `lastNudgedAt` either null or
past `NUDGE_COOLDOWN_HOURS` (default 24) ago, and no active wallet — this
last condition alone is the full activation check; there's deliberately no
"has at least one wallet" requirement, so someone who onboarded via
`/start` but never created or imported a wallet at all still qualifies, not
just users with an inactive one.

**Message content is admin-managed, not hardcoded** — the `NudgeMessage`
model (styled after `Rule`: create + active-toggle only, no update/delete)
holds the actual copy, edited via the admin dashboard's `/nudges` page. A
user's `nudgeCount` picks the Nth active message ordered by `(order,
createdAt)`, clamped to the last one past the end. If no `NudgeMessage` rows
exist yet, the automatic cadence silently no-ops (safe by default) rather
than sending anything. Message content is honest reminders only — real
features, no fabricated urgency or time-limited discounts — same principle
as the Rewards Hub section above (a reference competitor bot's screenshots
showed this kind of message, but not its specific copy or claims).

Messages support Telegram's legacy Markdown (`sendMessage`'s `parse_mode:
"Markdown"`) — `*bold*`, `_italic_` — and may reference `${minDepositUsd}`,
substituted with the live `MIN_DEPOSIT_USD` setting at send time.

**Manual admin-triggered sends bypass the cooldown/cap entirely** rather
than going through a new admin→bot real-time event. `manualNudgeAction`
(`apps/admin/src/lib/actions.ts`) just writes `User.pendingManualNudgeMessageId`
for the selected users (a plain Postgres write — the admin app already talks
to Postgres directly for everything, per its own section above); the bot's
existing scheduled tick picks it up, sends it, and clears the field,
independent of `nudgeCount`/`lastNudgedAt`. This trades instant delivery for
zero new cross-process plumbing, which is a fine trade for a
non-latency-sensitive marketing message — an admin should expect up to one
`NUDGE_CHECK_INTERVAL_MS` of delay, not instant delivery.

### The marketing site (`apps/website`)

A real Next.js app (App Router, same conventions as `apps/admin`: its own
`package.json`/`tsconfig.json`, not in the root `tsc -b` project reference
graph, built via `next build`/`next dev`), not a static export — this
replaced an earlier flat HTML/CSS/JS mirror of the live
`https://clawdagents.bot` because that mirror could never be interactive:
Next.js's App Router hydration protocol needs a live server for its RSC
streaming payload, so a plain static-file server can display the pre-rendered
markup but can never attach real event handlers to it (confirmed directly —
a hydrated button has React fiber keys on it via `Object.keys(btn)`; the
static mirror's buttons had none, meaning clicks silently did nothing, no
console error, because there was nothing listening).

**Content approach — hybrid, not a full rewrite:** `apps/website/src/content/*.ts`
each export one big JSON-escaped HTML string (`homeContent`, `docsContent`,
etc.), extracted from the live site's own rendered markup and cleaned (splash
overlay removed, old broken nav block removed, React-streaming SSR noise like
`<script>` tags and `<div hidden id="S:0">` Suspense-boundary wrappers
stripped — the latter matters: leaving `hidden` on an unwrapped Suspense
marker permanently hides everything inside it, since nothing here replays
React 18's streaming reveal). These get rendered via `dangerouslySetInnerHTML`
in each page — safe here since it's the product's own marketing copy with no
user input in it, and avoids hand-transcribing thousands of lines of
marketing content into JSX. **Only the pieces that need real interactivity
are hand-built React**: `components/Header.tsx` (real `useState` mobile-menu
toggle — the original's equivalent button had zero attached handlers, for the
hydration reason above) and a few small effect-only components described
below. If you need to update marketing copy, edit the source HTML fragment
(re-extract from the live site if re-syncing, or hand-edit the string in
`content/*.ts` for small copy tweaks) — don't try to convert it to JSX
piecemeal, that defeats the reason this approach was chosen.

`globals.css` is the live site's own **compiled** CSS chunks concatenated
(not a fresh Tailwind build) — deliberately, because the original bundle has
bespoke component-level CSS (`.hero-orbit`, `.logoloop`, `.brand-gradient-text`,
etc.) that Tailwind's JIT compiler can't regenerate from class names alone;
it only knows how to emit its own utility-class lookup table. A handful of
utility classes used by the *new* hand-built components weren't present in
the original bundle (Tailwind only ships classes it finds actually used in
the source it scanned) — these are patched in by hand at the bottom of
`globals.css` (`.top-14`, `.w-56`, `.pr-4` currently) rather than standing up
a parallel Tailwind pipeline; if you add a new utility class to a hand-built
component, check whether it already exists in `globals.css` before assuming
it'll just work, and add it manually if not.

**Two real bugs found and fixed in the live site's own CSS/JS, not artifacts
of the extraction:**
- `globals.css` ships two `:root` color blocks — a safe hex fallback, and a
  `@supports (color:lab(0% 0 0))`-gated override using CSS Color 4 `lab()`
  wide-gamut colors. The `lab()` block is **stripped entirely** here: this
  Chromium build (and reportedly the browser used to view it) parses `lab()`
  as syntactically valid — so `getComputedStyle` reports a normal-looking
  color — but then fails to actually *paint* text with it, leaving apparently
  correctly-styled text invisible. Confirmed by force-overriding to plain
  `rgb()` and watching text appear. If `apps/website`'s colors ever look
  subtly off against the live site, this is why — it intentionally never
  uses the `lab()` variant.
- `globals.css` also has a sitewide blur-up rule,
  `img:not([data-loaded=true]){opacity:0;filter:blur(14px);...}` /
  `img[data-loaded=true]{opacity:1;...}` — the original's React `onLoad`
  handler that sets `data-loaded="true"` doesn't exist in the static
  extraction, so every image was permanently invisible (the file loads fine —
  openable directly by URL — it just never gets marked loaded).
  `components/ImageAutoLoad.tsx` restores this with a real `load`/`error`
  listener per `<img>`, plus a "propagate by `src`" step: the two marquee
  sections (`.logoloop`) duplicate the same logo URL twice for the seamless
  scroll illusion, and duplicate `<img>` tags pointing at an identical,
  already-cached URL don't reliably fire their own `load` event promptly —
  so once any element with a given `src` is confirmed loaded, every other
  current element sharing that exact `src` is marked immediately rather than
  waiting on its own event.

`components/ScrollReveal.tsx` replaces the original's scroll-in-view
animations (gated on the same splash-completion state that never fires
without a live server) with a real `IntersectionObserver`, targeting both the
Tailwind `.opacity-0` class pattern and the separate inline
`style="opacity:0"` pattern the original used in a few places (checked via
actual computed opacity, not just presence of either marker, so it catches
both mechanisms uniformly).

**Known gap:** `/docs` and `/legal/*` routes exist and use the same content
extraction pattern (`content/docs*.ts`, `content/legal*.ts`) and image-path
fixes, but haven't been through the same level of headless-vs-real-browser
visual verification as the homepage — worth a pass before treating them as
equally solid.
