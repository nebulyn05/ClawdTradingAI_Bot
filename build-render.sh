#!/usr/bin/env bash
set -euo pipefail

echo "=== Clawd Research Worker - Render Build ==="
npm install --include=optional
npm rebuild @prisma/engines
npx prisma generate --schema packages/db/prisma/schema.prisma
npx tsc -b apps/research-worker
echo "=== Research worker build completed ==="
