#!/usr/bin/env bash
# Render build script for Clawd Agents monorepo
# This runs at the root of the repo and builds packages in dependency order

set -euo pipefail

echo "🔨 Building Clawd Agents monorepo for Render..."

# 1. Install all dependencies (including devDependencies for build)
echo "📦 Installing dependencies..."
npm ci

# 2. Generate Prisma client FIRST (required by @clawd/db and all packages using it)
echo "🗄️  Generating Prisma client..."
npm run db:generate

# 3. Build all shared packages in dependency order (tsc -b handles this via project references)
echo "🔧 Building shared packages..."
npm run build

# 4. Build each Next.js app (they import compiled @clawd/* packages)
echo "🌐 Building admin dashboard..."
cd apps/admin
npm run build
cd ../..

echo "🌐 Building marketing website..."
cd apps/website
npm run build
cd ../..

echo "✅ Build complete!"