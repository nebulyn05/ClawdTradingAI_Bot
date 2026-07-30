# First Local Run — Walkthrough

A step-by-step path from a fresh clone to watching the bot open and close a
real (testnet) trade, with the admin dashboard open alongside it. This
assumes you've read the architecture overview in `README.md` / `CLAUDE.md`
but haven't actually run anything yet.

Everything here targets **testnet/devnet** — that's the default for every
chain, and this walkthrough doesn't change it. Nothing in this guide risks
real funds.

## 0. Prerequisites

- Node.js 20+ and npm
- Docker (for local Postgres + Redis)
- A Telegram account (to talk to your bot and to create it via @BotFather)

Check versions:

```bash
node -v   # should be >= 20
docker -v
```

## 1. Clone and install

```bash
git clone <your-fork-or-repo-url>
cd ClawdTradingAI_Bot
npm install
```

`npm install` sets up all the npm workspaces (`apps/*`, `packages/*`,
`packages/specialists/*`) in one pass — there's nothing to install
per-package.

## 2. Create your `.env`

```bash
cp .env.example .env
```

Open `.env` in an editor. You do **not** need to fill in everything before
starting — missing optional keys degrade gracefully (a feature just logs a
warning and stays off). Here's the minimum to get a real end-to-end trade
working on Solana devnet, the fastest chain to test with:

### 2a. Required no matter what

**`TELEGRAM_BOT_TOKEN`**
1. Open Telegram, message [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, follow the prompts (pick any name/username)
3. Copy the token it gives you into `.env`

**`MASTER_ENCRYPTION_KEY`** — wraps every user's wallet key. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output in. Don't reuse this across environments, don't commit it.

### 2b. Recommended so Solana devnet actually works well

**`HELIUS_API_KEY`** — free at [helius.dev](https://www.helius.dev). Without
it, Solana falls back to the public devnet RPC, which is rate-limited enough
that Sniper's live subscription can be flaky. Not required to get started,
but recommended before you judge whether Sniper is "working."

Leave every other section of `.env` at its defaults for now — Ethereum/BSC/
Base/Monad/Robinhood-Chain testnets already have public RPC defaults filled
in, and every AI/Twitter/MEV/LI.FI feature is off or gracefully degraded
without extra keys.

## 3. Start local infrastructure

```bash
docker compose up -d
```

This starts Postgres (`clawd_agents` db, user/pass `clawd`/`clawd`, matching
the `DATABASE_URL` already in `.env.example`) and Redis on their default
ports. Confirm both are up:

```bash
docker compose ps
```

## 4. Build and migrate

```bash
npm run build       # tsc -b across every package — do this before first run, and after pulling changes
npm run db:migrate   # applies the Prisma schema to your local Postgres, prompts for a migration name on first run
```

`db:migrate` will ask you to name the initial migration (anything like
`init` is fine) — this repo doesn't ship pre-generated migration files, so
this step creates them against your database.

## 5. Start the bot and the worker

Open two terminals (both from the repo root):

```bash
# terminal 1
npm run dev:bot
```

```bash
# terminal 2
npm run dev:worker
```

You should see log lines from both — the bot logs its Telegram username on
startup, the worker logs `Sniper watching for new pairs` for Solana and
(expected, not an error) warnings for the EVM chains, since no
`*_FACTORY_ADDRESS` is configured for a testnet DEX yet:

```
WARN  Could not start Sniper for chain — adapter not fully configured?  chain: "ethereum"
```

That's normal — this walkthrough only exercises Solana.

## 6. Talk to your bot

In Telegram, open the bot you created and send:

```
/start
```

It creates a wallet for all 6 chains and shows you the addresses. You only
need the **Solana** one for this walkthrough.

## 7. Fund the Solana wallet (devnet)

Copy the Solana address from `/start`'s output, then either:

```bash
solana airdrop 1 <address> --url devnet
```

or use [faucet.solana.com](https://faucet.solana.com) if you don't have the
Solana CLI installed.

Confirm it landed:

```
/wallets
```

should show a non-zero Solana balance within a few seconds.

## 8. Deploy the wallet

```
/deploy solana
```

This flips `active: true` on your Solana wallet — from this point on, the
worker's Sniper → Guard → Router pipeline will trade it automatically the
next time it detects a qualifying Pump.fun launch.

## 9. Watch it trade

Keep an eye on:
- **The worker terminal** — you'll see `Screening candidate` and
  `Position opened`/`Skipping` log lines as Sniper detects launches.
- **Telegram** — you'll get a DM the moment a position opens
  (`🟢 Opened a solana position in ...`) and again when it closes
  (`✅ Profit` or `❌ Loss`), with the entry/exit price and fee.

This can take anywhere from seconds to a while, depending on how active
Pump.fun devnet-equivalent launch activity is at the time — Sniper only
reacts to real launches, it doesn't simulate anything. If you want to force
a trade sooner to verify the pipeline rather than wait, see
**Troubleshooting → "I don't want to wait for a real launch"** below.

## 10. Open the admin dashboard

In a third terminal:

```bash
npm run dev:admin
```

Before your first login, generate an admin password hash (from the repo
root, after `npm install && npm run build`):

```bash
DATABASE_URL=x REDIS_URL=x node -e "require('@clawd/wallet').hashPassphrase(process.argv[1]).then(console.log)" "pick-a-password"
```

(The dummy `DATABASE_URL`/`REDIS_URL` are required because importing
`@clawd/wallet` transitively loads `@clawd/core`'s config validation, even
though `hashPassphrase` itself needs neither.)

Set in `.env`:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<the scrypt:... string that command printed>
ADMIN_SESSION_SECRET=<another random value, same one-liner as MASTER_ENCRYPTION_KEY, but a DIFFERENT value>
```

Restart `npm run dev:admin` after editing `.env` (env vars are read once at
process start), then open **http://localhost:3000**, log in, and you should
see:
- **Overview** — your one user, your wallets, any positions/fees from step 9
- **Users & Wallets** — the deploy/pause toggle you used via `/deploy`
- **Positions & Trades** — the trade(s) from step 9, with entry/exit prices
- **Settings** — the live take-profit/stop-loss/fee/concurrency knobs

Try changing `TAKE_PROFIT_PCT` on the Settings page — it takes effect on the
worker's *next* trade immediately, no restart needed.

## Troubleshooting

**"Invalid environment configuration" on startup** — one of the required
env vars (`DATABASE_URL`, `REDIS_URL`, or `MASTER_ENCRYPTION_KEY`'s hex
format) is missing or malformed. The error message lists every failing
field.

**Worker warns about Ethereum/BSC/Base/Monad/Robinhood Chain on startup** —
expected in this walkthrough; those need a `*_FACTORY_ADDRESS` env var
pointing at a real testnet DEX before Sniper will watch them (see
`.env.example`'s EVM section). Solana works out of the box.

**`db:migrate` fails to connect** — check `docker compose ps` shows Postgres
as `Up`, and that `DATABASE_URL` in `.env` matches the credentials in
`docker-compose.yml` (defaults: `clawd`/`clawd`/`clawd_agents` on
`localhost:5432`).

**I don't want to wait for a real launch** — use the admin dashboard's
**Manual Trade** page (step 10) to buy a known Solana devnet token directly
through Router, bypassing Sniper/Guard entirely — this is the fastest way to
confirm the open → monitor → close → notification loop works end-to-end
without waiting on real market activity. Use a real, liquid devnet token
address you know has a tradeable Jupiter route.

**Notifications aren't arriving in Telegram** — the bot and worker
communicate trade events through Redis (see `CLAUDE.md`'s "process
boundaries" section). Confirm both processes are running and
`docker compose ps` shows Redis as `Up`.

**Rebuild after pulling new changes** — always re-run `npm run build`
(and `npm run db:migrate` if the Prisma schema changed) before restarting
the bot/worker/admin; they run compiled output, not live TypeScript.

## What this walkthrough intentionally skips

- Mainnet of any chain (see `README.md` → "Networks & going to mainnet")
- AI features, KOL/Twitter tracking, MEV protection (Jito/Flashbots), and
  real 1inch/LI.FI execution — all optional, all documented in
  `.env.example` and `README.md`'s setup section
- A real KMS for `MASTER_ENCRYPTION_KEY` (see `README.md` →
  "Production hardening") — fine for local development, not for production
