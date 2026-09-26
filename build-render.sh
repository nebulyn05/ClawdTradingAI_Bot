#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo " Clawd Trading Bot - Render Build"
echo "========================================"

echo "📦 Installing dependencies (including dev dependencies needed to compile)..."
npm ci --include=dev

echo "🧹 Cleaning TypeScript build artifacts..."
find . -type d \( -name dist -o -name .turbo \) -prune -exec rm -rf {} +
find . -name "*.tsbuildinfo" -delete

echo "🗄️ Generating Prisma Client..."
npm run db:generate

echo "🗄️ Initializing PostgreSQL database..."
npx prisma db push --schema packages/db/prisma/schema.prisma

echo "🔨 Building bot and only the packages required by the bot..."
npx tsc -b --pretty

echo "✅ Bot-only Render build completed successfully"
