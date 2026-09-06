#!/usr/bin/env node
/**
 * Render API Direct Deployment for Clawd Agents
 * Uses the provided API token directly
 *
 * Run: node deploy-render-direct.js
 */

import fetch from 'node-fetch';

const RENDER_API_BASE = 'https://api.render.com/v1';
const API_TOKEN = 'rnd_hEvISDVyZ2dH69asjogK2yneRJEA';

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
// CONFIGURATION - UPDATE THESE VALUES
// ──────────────────────────────────────────────────────────────────────────

const REPO_URL = 'https://github.com/nebulyn05/ClawdTradingAI_Bot'; // ← CHANGE THIS
const BRANCH = 'main';
const REGION = 'oregon';

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
      { key: 'RENDER_ADMIN_URL', value: 'https://clawd-admin.onrender.com' },
      { key: 'RENDER_WEBSITE_URL', value: 'https://clawd-website.onrender.com' },
    ],
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
  },
];

// ──────────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Clawd Agents - Render API Direct Deployment                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (REPO_URL.includes('YOUR_GITHUB_USERNAME')) {
    console.error('❌ Please edit deploy-render-direct.js and set REPO_URL to your GitHub repo');
    process.exit(1);
  }

  try {
    // 1. Create PostgreSQL
    console.log('📦 Creating PostgreSQL database...');
    const db = await apiRequest('POST', '/postgres', {
      name: 'clawd-postgres',
      databaseName: 'clawd_agents',
      user: 'clawd',
      region: REGION,
      plan: 'starter',
    });
    console.log(`✅ Database: ${db.id}`);

    // 2. Create Redis
    console.log('📦 Creating Redis...');
    const redis = await apiRequest('POST', '/redis', {
      name: 'clawd-redis',
      region: REGION,
      plan: 'starter',
    });
    console.log(`✅ Redis: ${redis.id}`);

    // 3. Create services
    const services = {};
    for (const svc of SERVICES) {
      console.log(`🚀 Creating ${svc.type}: ${svc.name}...`);
      const payload = {
        type: svc.type,
        name: svc.name,
        repo: REPO_URL,
        branch: BRANCH,
        rootDir: svc.rootDir,
        buildCommand: svc.buildCommand,
        startCommand: svc.startCommand,
        region: REGION,
        plan: svc.plan,
        envVars: svc.envVars,
      };
      if (svc.healthCheckPath) payload.healthCheckPath = svc.healthCheckPath;

      const service = await apiRequest('POST', '/services', payload);
      services[svc.name] = service;
      console.log(`✅ ${svc.name}: ${service.id}`);
      await new Promise(r => setTimeout(r, 2000));
    }

    // 4. Get actual URLs
    console.log('\n🔗 Getting service URLs...');
    const adminSvc = await apiRequest('GET', `/services/${services['clawd-admin'].id}`);
    const websiteSvc = await apiRequest('GET', `/services/${services['clawd-website'].id}`);
    const adminUrl = adminSvc.serviceDetails?.url || `https://clawd-admin.onrender.com`;
    const websiteUrl = websiteSvc.serviceDetails?.url || `https://clawd-website.onrender.com`;
    console.log(`   Admin: ${adminUrl}`);
    console.log(`   Website: ${websiteUrl}`);

    // 5. Update worker with actual URLs
    console.log('\n🔧 Updating worker keep-alive URLs...');
    await apiRequest('PUT', `/services/${services['clawd-worker'].id}/env-vars`, {
      envVars: [
        { key: 'RENDER_ADMIN_URL', value: adminUrl },
        { key: 'RENDER_WEBSITE_URL', value: websiteUrl },
      ],
    });

    // 6. Wait for DBs then deploy
    console.log('\n⏳ Waiting 30s for databases to provision...');
    await new Promise(r => setTimeout(r, 30000));

    console.log('\n🚀 Triggering deploys...');
    const deploys = {};
    for (const [name, service] of Object.entries(services)) {
      const deploy = await apiRequest('POST', `/services/${service.id}/deploys`, { clearCache: false });
      deploys[name] = { serviceId: service.id, deployId: deploy.id };
      console.log(`   ${name}: deploy ${deploy.id}`);
    }

    // 7. Wait for completion
    console.log('\n⏳ Waiting for deploys to complete...');
    for (const [name, { serviceId, deployId }] of Object.entries(deploys)) {
      while (true) {
        const deploy = await apiRequest('GET', `/services/${serviceId}/deploys/${deployId}`);
        console.log(`   ${name}: ${deploy.status}`);
        if (deploy.status === 'live') {
          console.log(`   ✅ ${name} is live!`);
          break;
        }
        if (['build_failed', 'update_failed', 'canceled'].includes(deploy.status)) {
          throw new Error(`${name} deploy failed: ${deploy.status}`);
        }
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ DEPLOYMENT COMPLETE!                                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n📋 Admin: ${adminUrl}`);
    console.log(`📋 Website: ${websiteUrl}`);
    console.log('\n⚠️  Remember to set environment variables in Render Dashboard!');

  } catch (error) {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  }
}

main();