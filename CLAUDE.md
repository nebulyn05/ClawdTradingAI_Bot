# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Clawd Agents — a multi-chain autonomous crypto trading bot on Telegram, plus
an operator admin dashboard. Users get a custodial wallet per chain
(generated or imported inside the bot); five specialist services (Sniper,
Scout, Guard, Arbiter, Router) watch for opportunities, screen them for
safety, and trade automatically with auto take-profit/stop-loss. A 2% fee is
taken only on profitable closed trades.

The repo also still contains the original static marketing site at the root
(`index.html`, `css/`, `js/`, `images/`, `fonts/`, `media/`) — that's the
pre-existing landing page this product was built to match, unrelated to the
application code under `apps/`/`packages/`.

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

## Architecture

```
apps/
  bot/        Telegram bot (grammY): onboarding, wallet management, notifications
  worker/     Background process: Sniper/Scout -> Guard -> Router pipeline, position monitor, Arbiter scan, rule engine
  admin/      Next.js operator dashboard — separate process, reads/writes the same Postgres directly (no API layer)
packages/
  core/       Env config (zod), logger, in-process event bus + Redis bridge, runtime Setting overrides, shared domain types
  db/         Prisma schema (Postgres) + generated client
  wallet/     Keygen + envelope-encrypted custody (all 6 chains)
  chains/     ChainAdapter interface + implementations (solana/, evm/ — the evm/ family covers Ethereum, BSC, Base, Monad, Robinhood Chain)
  pricing/    Birdeye, DexScreener, Pyth, Chainlink price-feed clients
  ai/         Anthropic client + prompts (Guard's qualitative gate, tweet interpretation, TP/SL reasoning) — all behind AI_FEATURES_ENABLED
  specialists/
    guard/    Safety screening (liquidity, mint/freeze authority, honeypot, holder concentration) + AI final gate
    sniper/   New-launch/new-pair detection
    scout/    Smart-money wallet tracking + KOL/Twitter call interpretation
    arbiter/  Cross-chain price-spread detection (real LI.FI quotes) + EVM<->EVM bridge execution
    router/   Trade execution, auto TP/SL (+ periodic AI re-evaluation), position lifecycle, fee ledger, admin rule engine
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
directly, wherever the dashboard is meant to be able to override it.

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
a decrypted key from a function; `exportRawKey` is the sole, explicitly-named
exception, and it's only ever called after the bot's passphrase-gated
re-auth flow (`apps/bot/src/conversations/export-key.ts`) — it performs no
auth itself, so any new caller must do that check first.

The admin dashboard's session auth (`apps/admin/src/lib/auth.ts`,
`session.ts`) reuses this same package's `hashPassphrase`/`verifyPassphrase`
(scrypt-based) for the operator's login credential, rather than introducing
a second hashing scheme.
