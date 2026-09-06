#!/usr/bin/env node
/**
 * Render API Deployment Script for Clawd Agents
 *
 * Usage: node deploy-render.js
 *
 * Requires: RENDER_API_TOKEN environment variable or pass as argument
 * Example: RENDER_API_TOKEN=rnd_xxx node deploy-render.js
 */

import fetch from 'node-fetch';

const RENDER_API_BASE = 'https://api.render.com/v1';
const API_TOKEN = process.env.RENDER_API_TOKEN || process.argv[2];

if (!API_TOKEN) {
  console.error('❌ RENDER_API_TOKEN not set. Set env var or pass as first argument.');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

async function apiRequest(method, path, body) {
  const url = `${RENDER_API_BASE}${path}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`API ${method} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// ──────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────────────────────────────────

const REPO_URL = 'https://github.com/nebulyn05/ClawdTradingAI_Bot';
const BRANCH = 'main';
const REGION = 'oregon'; // or 'frankfurt', 'singapore', 'virginia'

const ENV_GROUPS = {
  'clawd-core': [
    'MASTER_ENCRYPTION_KEY',
    'ADMIN_SESSION_SECRET',
    'MIN_DEPOSIT_USD',
    'KEY_REVEAL_AUTO_DELETE_SECONDS',
    'BOT_WEBSITE_URL',
    'BOT_DOCS_URL',
    'BOT_CHANNEL_URL',
    'BOT_SUPPORT_URL',
    'PROFIT_FEE_RATE',
    'FEE_TREASURY_SOLANA_ADDRESS',
    'FEE_TREASURY_EVM_ADDRESS',
  ],
  'clawd-telegram': [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_ADMIN_CHAT_ID',
  ],
  'clawd-chains': [
    'SOLANA_NETWORK', 'ETHEREUM_NETWORK', 'BSC_NETWORK', 'BASE_NETWORK',
    'MONAD_NETWORK', 'ROBINHOOD_NETWORK',
    'HELIUS_API_KEY',
    'SOLANA_DEVNET_RPC_URL', 'SOLANA_MAINNET_RPC_URL',
    'SOLANA_DEVNET_RPC_FALLBACK_URLS', 'SOLANA_MAINNET_RPC_FALLBACK_URLS',
    'JUPITER_API_BASE',
    'ALCHEMY_API_KEY', 'QUICKNODE_ETHEREUM_URL', 'QUICKNODE_BSC_URL', 'QUICKNODE_BASE_URL',
    'ETHEREUM_TESTNET_RPC_URL', 'ETHEREUM_MAINNET_RPC_URL',
    'BSC_TESTNET_RPC_URL', 'BSC_MAINNET_RPC_URL',
    'BASE_TESTNET_RPC_URL', 'BASE_MAINNET_RPC_URL',
    'MONAD_MAINNET_RPC_URL', 'MONAD_TESTNET_RPC_URL',
    'ROBINHOOD_MAINNET_RPC_URL', 'ROBINHOOD_TESTNET_RPC_URL',
    'ETHEREUM_TESTNET_RPC_FALLBACK_URLS', 'ETHEREUM_MAINNET_RPC_FALLBACK_URLS',
    'BSC_TESTNET_RPC_FALLBACK_URLS', 'BSC_MAINNET_RPC_FALLBACK_URLS',
    'BASE_TESTNET_RPC_FALLBACK_URLS', 'BASE_MAINNET_RPC_FALLBACK_URLS',
    'MONAD_TESTNET_RPC_FALLBACK_URLS', 'MONAD_MAINNET_RPC_FALLBACK_URLS',
    'ROBINHOOD_TESTNET_RPC_FALLBACK_URLS', 'ROBINHOOD_MAINNET_RPC_FALLBACK_URLS',
    'ETHEREUM_MAINNET_WS_URL', 'ETHEREUM_TESTNET_WS_URL',
    'BSC_MAINNET_WS_URL', 'BSC_TESTNET_WS_URL',
    'BASE_MAINNET_WS_URL', 'BASE_TESTNET_WS_URL',
    'MONAD_MAINNET_WS_URL', 'MONAD_TESTNET_WS_URL',
    'ROBINHOOD_MAINNET_WS_URL', 'ROBINHOOD_TESTNET_WS_URL',
    'ETHEREUM_FACTORY_ADDRESS', 'ETHEREUM_ROUTER_ADDRESS', 'ETHEREUM_WRAPPED_NATIVE_ADDRESS',
    'BSC_FACTORY_ADDRESS', 'BSC_ROUTER_ADDRESS', 'BSC_WRAPPED_NATIVE_ADDRESS',
    'BASE_FACTORY_ADDRESS', 'BASE_ROUTER_ADDRESS', 'BASE_WRAPPED_NATIVE_ADDRESS',
    'MONAD_FACTORY_ADDRESS', 'MONAD_ROUTER_ADDRESS', 'MONAD_WRAPPED_NATIVE_ADDRESS',
    'ROBINHOOD_FACTORY_ADDRESS', 'ROBINHOOD_ROUTER_ADDRESS', 'ROBINHOOD_WRAPPED_NATIVE_ADDRESS',
    'ONEINCH_API_KEY',
    'FLASHBOTS_ENABLED', 'FLASHBOTS_RPC_URL',
    'JITO_ENABLED', 'JITO_BLOCK_ENGINE_URL', 'JITO_TIP_LAMPORTS', 'JITO_TIP_ACCOUNTS',
    'BIRDEYE_API_KEY', 'DEXSCREENER_API_BASE',
    'LIFI_API_KEY',
    'ETHERSCAN_API_KEY',
  ],
  'clawd-ai': [
    'AI_FEATURES_ENABLED',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
    'AI_TP_SL_REVIEW_INTERVAL_MS',
  ],
  'clawd-features': [
    'TAKE_PROFIT_PCT', 'STOP_LOSS_PCT',
    'MAX_CONCURRENT_POSITIONS_PER_CHAIN',
    'MAX_PORTFOLIO_EXPOSURE_PCT',
    'KELLY_FRACTION', 'MAX_POSITION_SIZE_PCT',
    'POSITION_MONITOR_INTERVAL_MS',
    'DRAWDOWN_WINDOW_MS', 'DRAWDOWN_THRESHOLD_PCT', 'DRAWDOWN_CHECK_INTERVAL_MS',
    'GUARD_DRIFT_CHECK_INTERVAL_MS', 'GUARD_DRIFT_ALERT_THRESHOLD_PCT', 'GUARD_DRIFT_ROLLING_WINDOW_SIZE',
    'ARBITER_SCAN_INTERVAL_MS', 'ARBITER_ASSUMED_BRIDGE_COST_PCT', 'ARBITER_MIN_SPREAD_PCT', 'ARBITER_QUOTE_SIZE',
    'TWITTER_BEARER_TOKEN', 'KOL_TWITTER_HANDLES', 'TWITTER_POLL_INTERVAL_MS',
    'RULE_ENGINE_INTERVAL_MS',
  ],
};

const SERVICES = [
  {
    name: 'clawd-bot',
    type: 'worker',
    rootDir: '.',
    plan: 'starter',
    buildCommand: './build-render.sh',
    startCommand: 'node apps/bot/dist/main.js',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'LOG_LEVEL', value: 'info' },
    ],
    envGroups: ['clawd-core', 'clawd-telegram', 'clawd-chains', 'clawd-ai', 'clawd-features'],
  },
  {
    name: 'clawd-worker',
    type: 'worker',
    rootDir: '.',
    plan: 'starter',
    buildCommand: './build-render.sh',
    startCommand: 'node apps/worker/dist/main.js',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'LOG_LEVEL', value: 'info' },
      // Keep-alive URLs (will be updated after web services create)
      { key: 'RENDER_ADMIN_URL', value: 'https://clawd-admin.onrender.com' },
      { key: 'RENDER_WEBSITE_URL', value: 'https://clawd-website.onrender.com' },
    ],
    envGroups: ['clawd-core', 'clawd-chains', 'clawd-ai', 'clawd-features'],
  },
  {
    name: 'clawd-admin',
    type: 'web',
    rootDir: '.',
    plan: 'starter',
    buildCommand: './build-render.sh',
    startCommand: 'cd apps/admin && npm run start',
    healthCheckPath: '/api/health',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'NEXT_TELEMETRY_DISABLED', value: '1' },
      { key: 'RENDER_ADMIN_URL', value: 'https://clawd-admin.onrender.com' },
    ],
    envGroups: ['clawd-core', 'clawd-chains'],
  },
  {
    name: 'clawd-website',
    type: 'web',
    rootDir: '.',
    plan: 'starter',
    buildCommand: './build-render.sh',
    startCommand: 'cd apps/website && npm run start',
    healthCheckPath: '/api/health',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'NEXT_TELEMETRY_DISABLED', value: '1' },
      { key: 'RENDER_WEBSITE_URL', value: 'https://clawd-website.onrender.com' },
    ],
    envGroups: [],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// DEPLOYMENT FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────

async function createDatabase() {
  console.log('📦 Creating PostgreSQL database...');
  const db = await apiRequest('POST', '/postgres', {
    name: 'clawd-postgres',
    databaseName: 'clawd_agents',
    user: 'clawd',
    region: REGION,
    plan: 'starter',
  });
  console.log(`✅ Database created: ${db.id}`);
  return db;
}

async function createRedis() {
  console.log('📦 Creating Redis instance...');
  const redis = await apiRequest('POST', '/redis', {
    name: 'clawd-redis',
    region: REGION,
    plan: 'starter',
  });
  console.log(`✅ Redis created: ${redis.id}`);
  return redis;
}

async function createService(serviceConfig, repoUrl, branch) {
  console.log(`🚀 Creating ${serviceConfig.type} service: ${serviceConfig.name}...`);

  const payload = {
    type: serviceConfig.type,
    name: serviceConfig.name,
    repo: repoUrl,
    branch: branch,
    rootDir: serviceConfig.rootDir,
    buildCommand: serviceConfig.buildCommand,
    startCommand: serviceConfig.startCommand,
    region: REGION,
    plan: serviceConfig.plan,
    envVars: serviceConfig.envVars,
  };

  if (serviceConfig.healthCheckPath) {
    payload.healthCheckPath = serviceConfig.healthCheckPath;
  }

  const service = await apiRequest('POST', '/services', payload);
  console.log(`✅ Service created: ${service.name} (${service.id})`);
  return service;
}

async function setEnvVars(serviceId, envVars) {
  console.log(`🔧 Setting ${envVars.length} environment variables for service ${serviceId}...`);
  await apiRequest('PUT', `/services/${serviceId}/env-vars`, { envVars });
  console.log(`✅ Environment variables set`);
}

async function triggerDeploy(serviceId, clearCache = false) {
  console.log(`🚀 Triggering deploy for service ${serviceId}...`);
  const deploy = await apiRequest('POST', `/services/${serviceId}/deploys`, { clearCache });
  console.log(`✅ Deploy triggered: ${deploy.id}`);
  return deploy;
}

async function waitForDeploy(serviceId, deployId, timeoutMs = 600000) {
  console.log(`⏳ Waiting for deploy ${deployId} to complete...`);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const deploy = await apiRequest('GET', `/services/${serviceId}/deploys/${deployId}`);
    console.log(`   Status: ${deploy.status}`);

    if (deploy.status === 'live') {
      console.log(`✅ Deploy live!`);
      return deploy;
    }
    if (['build_failed', 'update_failed', 'canceled'].includes(deploy.status)) {
      throw new Error(`Deploy failed with status: ${deploy.status}`);
    }

    await new Promise(r => setTimeout(r, 10000)); // Poll every 10s
  }

  throw new Error(`Deploy timed out after ${timeoutMs}ms`);
}

async function getServiceUrl(serviceId) {
  const service = await apiRequest('GET', `/services/${serviceId}`);
  return service.serviceDetails?.url || `https://${service.name}.onrender.com`;
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN DEPLOYMENT FLOW
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Clawd Agents - Render API Deployment                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Create databases
    const db = await createDatabase();
    const redis = await createRedis();

    // Step 2: Create services
    const services = {};
    for (const svcConfig of SERVICES) {
      const service = await createService(svcConfig, REPO_URL, BRANCH);
      services[svcConfig.name] = service;

      // Small delay between service creations
      await new Promise(r => setTimeout(r, 2000));
    }

    // Step 3: Get actual URLs for web services (for keep-alive)
    console.log('\n🔗 Getting service URLs...');
    const adminUrl = await getServiceUrl(services['clawd-admin'].id);
    const websiteUrl = await getServiceUrl(services['clawd-website'].id);
    console.log(`   Admin: ${adminUrl}`);
    console.log(`   Website: ${websiteUrl}`);

    // Step 4: Update worker with actual URLs
    console.log('\n🔧 Updating worker keep-alive URLs...');
    await setEnvVars(services['clawd-worker'].id, [
      { key: 'RENDER_ADMIN_URL', value: adminUrl },
      { key: 'RENDER_WEBSITE_URL', value: websiteUrl },
    ]);

    // Step 5: Trigger initial deploys (databases need to be ready first)
    console.log('\n⏳ Waiting for databases to be ready...');
    await new Promise(r => setTimeout(r, 30000)); // Give DB time to provision

    console.log('\n🚀 Triggering initial deploys...');
    const deployPromises = Object.entries(services).map(async ([name, service]) => {
      const deploy = await triggerDeploy(service.id);
      return { name, serviceId: service.id, deployId: deploy.id };
    });

    const deploys = await Promise.all(deployPromises);

    // Step 6: Wait for all deploys
    console.log('\n⏳ Waiting for all deploys to complete...');
    await Promise.all(deploys.map(d => waitForDeploy(d.serviceId, d.deployId)));

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ DEPLOYMENT COMPLETE!                                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('\n📋 Service URLs:');
    console.log(`   Admin Dashboard: ${adminUrl}`);
    console.log(`   Marketing Site:  ${websiteUrl}`);
    console.log('\n📋 Next Steps:');
    console.log('   1. Set environment variables in Render Dashboard > Environment Groups');
    console.log('   2. Attach env groups to services as documented in render.yaml');
    console.log('   3. Configure custom domain if needed');
    console.log('   4. Monitor logs in Render Dashboard');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

main();