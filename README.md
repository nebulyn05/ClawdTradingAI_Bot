# Clawd Agents

Multi-chain autonomous crypto trading bot on Telegram. Users get a custodial
wallet per chain, generated or imported inside the bot; five specialist
services (Sniper, Scout, Guard, Arbiter, Router) watch for opportunities,
screen them for safety, and trade automatically with auto take-profit/
stop-loss. A 2% fee is taken only on profitable closed trades.

**Every chain defaults to testnet/devnet.** Flip a chain to mainnet only
after you've verified it end-to-end with real testnet funds — see
[Networks](#networks--going-to-mainnet) below.

## Architecture

```
apps/
  bot/                Telegram bot (grammY): onboarding, wallet management, notifications
  worker/             Background process: Sniper/Scout -> Guard -> Router pipeline, position monitor, Arbiter scan
packages/
  core/               Env config (zod-validated), logger, in-process event bus + Redis bridge, shared types
  db/                 Prisma schema (Postgres) + generated client
  wallet/              Keygen + envelope-encrypted custody (Solana + EVM)
  chains/             ChainAdapter interface + implementations (solana, evm, monad/robinhood stubs)
  pricing/            Birdeye + DexScreener price-feed clients
  specialists/
    guard/            Safety screening (liquidity, mint/freeze authority, honeypot, holder concentration)
    sniper/           New-launch/new-pair detection
    scout/            Smart-money wallet tracking
    arbiter/          Cross-chain price-spread detection (detection only, not auto-traded)
    router/           Trade execution, auto TP/SL, position lifecycle, fee ledger
```

The **bot** and **worker** are separate processes. The worker runs the
trading pipeline and emits events (position opened/closed, Guard rejections)
on an in-process event bus; since that doesn't cross process boundaries,
those specific events are also published to Redis, and the bot subscribes to
relay them to users as Telegram messages (see `packages/core/src/redis-bridge.ts`).

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

**Optional / follow-up:**
- `QUICKNODE_*_URL` — alternative RPC provider for BSC/Base mainnet.
- `LIFI_API_KEY` — not currently used by code (Arbiter's bridge-cost
  estimate is a fixed placeholder, see comments in
  `packages/specialists/arbiter/src/scan.ts`); reserved for a future
  real integration.
- `ONEINCH_API_KEY` — not currently used (EVM swaps execute via a direct
  Uniswap-V2-style router instead, since 1inch's aggregator has no testnet
  liquidity); reserved for a mainnet upgrade path.

### 3. Start local infrastructure and migrate the database

```bash
docker compose up -d
npm run db:migrate
```

### 4. Run

```bash
npm run dev:bot      # Telegram bot
npm run dev:worker   # trading pipeline (separate terminal/process)
```

Open your bot in Telegram and send `/start`. It creates wallets for Solana,
Ethereum, BSC, and Base automatically. Deposit testnet funds (see faucets
below), then `/deploy <chain>` to let the worker's pipeline auto-trade that
wallet. `/pause <chain>` stops it again.

### Testnet faucets

- Solana devnet: `solana airdrop 1 <address> --url devnet` or
  [faucet.solana.com](https://faucet.solana.com)
- Ethereum Sepolia: [sepoliafaucet.com](https://sepoliafaucet.com) or
  Alchemy's faucet
- BSC testnet: [testnet.bnbchain.org/faucet-smart](https://testnet.bnbchain.org/faucet-smart)
- Base Sepolia: [Coinbase's Base Sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)

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

## Networks & going to mainnet

Each chain's network is set independently via env var (`SOLANA_NETWORK`,
`ETHEREUM_NETWORK`, `BSC_NETWORK`, `BASE_NETWORK` — `testnet` or `mainnet`).
Flip one chain at a time, only after:

1. You've run it on testnet and watched at least one full open → close cycle
   succeed via the bot's notifications.
2. You've filled in that chain's mainnet RPC key (Helius/Alchemy/QuickNode).
3. For EVM chains beyond Ethereum/BSC (which have working mainnet DEX
   defaults baked in), you've set the `*_FACTORY_ADDRESS` /
   `*_ROUTER_ADDRESS` / `*_WRAPPED_NATIVE_ADDRESS` env vars for your chosen
   DEX — see `.env.example`.

**Monad and Robinhood Chain are explicit stubs** — every adapter method
throws rather than silently no-opping. There's no verified public RPC/SDK
for either wired in yet; see `packages/chains/src/stub.ts`.

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
- **EVM swap routing** is direct-pair only (no multi-hop through
  intermediate pools) and uses a Uniswap-V2-style router directly rather
  than an aggregator — see `packages/chains/src/evm/uniswap-v2.ts`.
- **Arbiter** is detection-only. It finds and logs/notifies cross-chain
  spreads but does not execute the buy-bridge-sell — that's a distinct,
  larger feature (real LI.FI or bridge-aggregator integration + execution
  monitoring) that isn't built.
- **Guard's EVM/Solana security data** comes from GoPlus Security's free
  API, which has little to no testnet coverage — on testnet, those specific
  checks are skipped (logged, not hard-failed) so development isn't blocked.
- No migration files are checked in yet (schema was iterated on without a
  live database in this environment) — running `npm run db:migrate` against
  your own Postgres will generate the initial migration.

## Testing

```bash
npm test
```

Runs the pure-logic unit tests (custody encryption round-trips, chain
adapter registry, Guard scoring rules, Router's TP/SL and fee math, Arbiter's
spread detection, native-amount formatting). Anything requiring a live RPC,
database, or Telegram connection is integration-level and needs to be
exercised by actually running the bot/worker against your own testnet
config — that's not something a unit test suite can fake meaningfully for a
system whose entire point is talking to real chains.
