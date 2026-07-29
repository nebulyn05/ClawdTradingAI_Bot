# Clawd Agents

Multi-chain autonomous crypto trading bot on Telegram. See `/root/.claude/plans` history or ask
the maintainer for the full design doc; this file will be filled in with setup instructions,
API key sources, and run commands as the build completes.

## Status

Work in progress — see the monorepo layout below.

```
apps/bot        Telegram bot (grammY)
apps/worker     Background workers: chain listeners, specialists pipeline, position monitor
packages/core   Config, logging, event bus, shared types
packages/db     Prisma schema + client
packages/wallet Key generation + envelope encryption
packages/chains Chain adapters (solana, evm, monad stub, robinhood stub)
packages/pricing Price feed clients
packages/specialists/{sniper,guard,scout,arbiter,router}
```

Full setup guide lands in a later commit.
