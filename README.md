# Clawd Agents

Multi-chain autonomous crypto trading bot on Telegram, plus an operator admin
dashboard. Users get a custodial wallet per chain, generated or imported
inside the bot; five specialist services (Sniper, Scout, Guard, Arbiter,
Router) watch for opportunities, screen them for safety, and trade
automatically with auto take-profit/stop-loss. A 2% fee is taken only on
profitable closed trades.

**Every chain defaults to testnet/devnet.** Flip a chain to mainnet only
after you've verified it end-to-end with real testnet funds — see
[Networks](#networks--going-to-mainnet) below.

## Architecture

```
apps/
  bot/                Telegram bot (grammY): onboarding, wallet management, notifications
  worker/             Background process: Sniper/Scout -> Guard -> Router pipeline, position monitor, Arbiter scan, rule engine
  admin/              Next.js operator dashboard: users/wallets/positions, manual trades, live settings, rule builder
packages/
  core/               Env config (zod-validated), logger, in-process event bus + Redis bridge, runtime Setting overrides, shared types
  db/                 Prisma schema (Postgres) + generated client
  wallet/             Keygen + envelope-encrypted custody (all 6 chains — Solana + 5 EVM-family chains)
  chains/             ChainAdapter interface + implementations (solana, evm — covers Ethereum/BSC/Base/Monad/Robinhood Chain)
  pricing/            Birdeye, DexScreener, Pyth, Chainlink price-feed clients
  ai/                 Anthropic client + prompts (Guard's qualitative gate, tweet interpretation, TP/SL reasoning)
  specialists/
    guard/            Safety screening (liquidity, mint/freeze authority, honeypot, holder concentration) + AI final gate
    sniper/           New-launch/new-pair detection
    scout/            Smart-money wallet tracking + KOL/Twitter call interpretation
    arbiter/          Cross-chain price-spread detection (real LI.FI quotes) + EVM<->EVM bridge execution
    router/           Trade execution, auto TP/SL (+ periodic AI re-evaluation), position lifecycle, fee ledger, admin rule engine
```

The **bot**, **worker**, and **admin** are separate processes. The worker
runs the trading pipeline and emits events (position opened/closed, Guard
rejections) on an in-process event bus; since that doesn't cross process
boundaries, those specific events are also published to Redis, and the bot
subscribes to relay them to users as Telegram messages (see
`packages/core/src/redis-bridge.ts`). The admin dashboard reads/writes the
same Postgres database directly — no separate API layer between them.

## Setup

### 1. Prerequisites

- Node.js 20+
- Docker (for local Postgres + Redis) — or point `DATABASE_URL`/`REDIS_URL`
  at your own instances.

### 2. Install and configure

```bash
npm install
cp .env.example .env
```

Fill in `.env` as you go — every section below says where to get that
specific value. Nothing needs to be perfect on day one; missing keys degrade
gracefully (a chain/feature just logs a warning and stays disabled) rather
than crashing the process.

**Required to run anything at all:**
- `TELEGRAM_BOT_TOKEN` — message [@BotFather](https://t.me/BotFather) on
  Telegram, `/newbot`, copy the token it gives you.
- `MASTER_ENCRYPTION_KEY` — generate one:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  This wraps every user's wallet encryption key. Never reuse it across
  environments, never commit it. In production, replace this env var with a
  real KMS (AWS KMS / GCP KMS) — see [Production hardening](#production-hardening).

**Recommended for a useful testnet run:**
- `HELIUS_API_KEY` — [helius.dev](https://www.helius.dev), free tier covers
  devnet + mainnet RPC.
- `ALCHEMY_API_KEY` — [alchemy.com](https://www.alchemy.com), for Ethereum
  mainnet RPC (testnets already have public defaults filled in).
- `BIRDEYE_API_KEY` — [birdeye.so/find-us](https://birdeye.so/find-us),
  Solana token pricing (DexScreener works without a key as a fallback).

**AI features (off by default — `AI_FEATURES_ENABLED=false`):**
- `ANTHROPIC_API_KEY` — [console.anthropic.com](https://console.anthropic.com/settings/keys).
  Powers Guard's final qualitative review gate, Scout's KOL tweet
  interpretation, and Router's periodic TP/SL reasoning. Everything works
  with this off; those three steps just no-op.
- `TWITTER_BEARER_TOKEN` + `KOL_TWITTER_HANDLES` — X API v2, needed for KOL
  tracking specifically. The tiers that support monitoring named accounts'
  posts are paid.

**Optional / follow-up:**
- `QUICKNODE_*_URL` — alternative RPC provider for BSC/Base mainnet.
- `LIFI_API_KEY` — LI.FI's public quote endpoint works without a key; this
  is for a higher rate limit.
- `ONEINCH_API_KEY` — enables real 1inch aggregator quotes/execution on EVM
  mainnet (falls back to a direct V2 router without it, which is also what's
  always used on testnets since 1inch has no testnet liquidity).
- `FLASHBOTS_ENABLED` / `JITO_ENABLED` — opt-in MEV-protected submission for
  Ethereum/Solana mainnet respectively. Untested against real funded wallets
  in this build — verify on a small size first.

### 3. Start local infrastructure and migrate the database

```bash
docker compose up -d
npm run db:migrate
```

### 4. Run

```bash
npm run dev:bot      # Telegram bot
npm run dev:worker   # trading pipeline (separate terminal/process)
npm run dev:admin    # operator dashboard at http://localhost:3000 (separate terminal/process)
```

Open your bot in Telegram and send `/start`. It creates wallets for all 6
supported chains automatically. Deposit testnet funds (see faucets below),
then `/deploy <chain>` to let the worker's pipeline auto-trade that wallet.
`/pause <chain>` stops it again.

### Testnet faucets

- Solana devnet: `solana airdrop 1 <address> --url devnet` or
  [faucet.solana.com](https://faucet.solana.com)
- Ethereum Sepolia: [sepoliafaucet.com](https://sepoliafaucet.com) or
  Alchemy's faucet
- BSC testnet: [testnet.bnbchain.org/faucet-smart](https://testnet.bnbchain.org/faucet-smart)
- Base Sepolia: [Coinbase's Base Sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)
- Monad testnet: [docs.monad.xyz](https://docs.monad.xyz) — testnet RPC and
  faucet links get updated there more often than is safe to hardcode.
- Robinhood Chain testnet: `https://faucet.testnet.chain.robinhood.com`

## Bot commands

| Command | What it does |
|---|---|
| `/start` | Onboarding — creates a wallet per supported chain if you don't have one |
| `/wallets` | List your wallets, live balances, and deploy status |
| `/import` | Import an existing wallet instead of the generated one |
| `/export` | Export a wallet's raw private key (passphrase-gated) |
| `/withdraw` | Send native tokens out to another address |
| `/deploy <chain>` | Let the worker's pipeline auto-trade that wallet |
| `/pause <chain>` | Stop auto-trading that wallet |

## Admin dashboard

`npm run dev:admin`, then log in with `ADMIN_USERNAME` / the password you
hashed into `ADMIN_PASSWORD_HASH`:

```bash
DATABASE_URL=x REDIS_URL=x node -e "require('@clawd/wallet').hashPassphrase(process.argv[1]).then(console.log)" "your-password-here"
```

(The dummy `DATABASE_URL`/`REDIS_URL` are required because importing
`@clawd/wallet` transitively loads `@clawd/core`'s config validation, even
though `hashPassphrase` itself needs neither.)

(Run from the repo root after `npm install && npm run build` so the
workspace packages are built.) Also set `ADMIN_SESSION_SECRET` to a random
value (same `randomBytes` one-liner as `MASTER_ENCRYPTION_KEY`, but a
**different** value — never reuse it).

Pages:
- **Overview** — user/wallet/position counts, fee revenue per chain, recent trades.
- **Users & Wallets** — every user's wallets with a deploy/pause toggle.
- **Positions & Trades** — every position, with a force-close action on open ones.
- **Manual Trade** — buy a specific token for a specific user's wallet directly
  through Router, bypassing Sniper/Scout/Guard entirely. Still subject to
  Router's own risk checks (duplicate-position guard, concurrency cap).
- **Settings** — live overrides for take-profit/stop-loss %, fee rate,
  concurrency cap, and per-specialist enable/disable — take effect
  immediately, no restart (see `packages/core/src/settings.ts`).
- **Rules** — define "if a user's profit on a chain exceeds X, buy them
  token Y," toggle rules on/off, and see the execution audit log. Runs
  through the same Router path as everything else, so it inherits the same
  risk checks.

## Networks & going to mainnet

Each chain's network is set independently via env var (`SOLANA_NETWORK`,
`ETHEREUM_NETWORK`, `BSC_NETWORK`, `BASE_NETWORK`, `MONAD_NETWORK`,
`ROBINHOOD_NETWORK` — `testnet` or `mainnet`). Flip one chain at a time, only
after:

1. You've run it on testnet and watched at least one full open → close cycle
   succeed via the bot's notifications.
2. You've filled in that chain's mainnet RPC key (Helius/Alchemy/QuickNode).
3. For EVM chains beyond Ethereum/BSC (which have working mainnet DEX
   defaults baked in), you've set the `*_FACTORY_ADDRESS` /
   `*_ROUTER_ADDRESS` / `*_WRAPPED_NATIVE_ADDRESS` env vars for your chosen
   DEX — see `.env.example`. **Robinhood Chain in particular is built for
   tokenized stocks/RWAs, not permissionless meme trading — it may not have
   a public AMM factory at all.** Wallet creation, balance, and withdraw
   work there regardless; Sniper/Router trading needs a real DEX deployed on
   it, which isn't something this build assumes exists.

All 6 chains have real (non-stub) adapters — Monad and Robinhood Chain use
the same EVM adapter family as Ethereum/BSC/Base, with chain IDs/RPC
defaults verified directly against viem's own chain definitions (143/10143
for Monad, 4663/46630 for Robinhood Chain).

## Production hardening

This is a real, working implementation, not a demo — but a few things are
intentionally left as documented follow-ups rather than guessed at:

- **KMS**: `MASTER_ENCRYPTION_KEY` is a raw env var. For production,
  swap the wrap/unwrap calls in `packages/wallet/src/crypto.ts` for a real
  KMS (AWS KMS, GCP KMS) so the master key is never in process memory or
  disk in plaintext.
- **Pump.fun launch parsing** (`packages/chains/src/solana/pumpfun.ts`) uses
  an account-key-position heuristic, not a full Anchor IDL decode. Good
  enough to detect *that* a launch happened; replace with real instruction
  decoding (or Helius' enhanced/parsed webhook API) before trusting it with
  size.
- **EVM swap routing**: real 1inch aggregation on mainnet when
  `ONEINCH_API_KEY` is set, falling back to a direct Uniswap-V2-style router
  (direct-pair only, no multi-hop) everywhere else — see
  `packages/chains/src/evm/adapter.ts`.
- **Arbiter's cost estimate is real** (a live LI.FI quote, not a fixed
  guess), and its EVM<->EVM bridge execution primitive is real too — but
  there's no orchestrator yet that picks a user's wallets on both chains and
  runs the full buy → bridge → sell, so opportunities are logged, not
  auto-traded. Solana-side bridge *execution* specifically isn't
  implemented (LI.FI's SVM signer interface needs verification this
  environment's blocked network access couldn't do) — Solana is still fully
  supported for cost-estimation quotes.
- **Guard's EVM/Solana security data** comes from GoPlus Security's free
  API, which has little to no testnet coverage — on testnet, those specific
  checks are skipped (logged, not hard-failed) so development isn't blocked.
- **Jito/Flashbots MEV protection** is real integration code, opt-in via
  `JITO_ENABLED`/`FLASHBOTS_ENABLED`, but hasn't been exercised against a
  live funded wallet in this environment — verify on testnet/small size
  first.
- **Pyth/Chainlink price feed IDs/addresses** are widely-reused constants,
  flagged in code for verification against current docs before relying on
  them with real size.
- No migration files are checked in yet (schema was iterated on without a
  live database in this environment) — running `npm run db:migrate` against
  your own Postgres will generate the initial migration.

## Testing

```bash
npm test
```

Runs the pure-logic unit tests (custody encryption round-trips, chain
adapter registry, Guard scoring rules, Router's TP/SL and fee math, Arbiter's
spread detection, native-amount formatting, AI fail-safe behavior with
features disabled). Anything requiring a live RPC, database, LLM call, or
Telegram connection is integration-level and needs to be exercised by
actually running the bot/worker/admin against your own testnet config —
that's not something a unit test suite can fake meaningfully for a system
whose entire point is talking to real chains and external APIs.
