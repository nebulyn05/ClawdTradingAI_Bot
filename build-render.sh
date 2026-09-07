#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo " Clawd Agents - Render Build"
echo "========================================"

echo "📦 Installing dependencies..."
npm ci

echo "🧹 Cleaning TypeScript build artifacts..."
find . -type d \( -name dist -o -name .turbo \) -prune -exec rm -rf {} +
find . -name "*.tsbuildinfo" -delete

echo "🗄️ Generating Prisma Client..."
npm run db:generate

echo "🗄️ Initializing PostgreSQL database..."
npx prisma db push --schema packages/db/prisma/schema.prisma

echo "🔨 Building TypeScript project references..."
npx tsc -b --pretty

echo "🌐 Building Admin..."
npm run build --workspace=@clawd/admin

echo "🌐 Building Website..."
npm run build --workspace=@clawd/website

echo "✅ Render build completed successfully"
