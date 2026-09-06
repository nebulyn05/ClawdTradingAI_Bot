#!/usr/bin/env node
/**
 * Render API Deployment for Clawd Agents
 * Adapted from the user's working payload pattern
 * Uses: env: "node" with buildCommand/startCommand (not Docker image)
 */

import fetch from 'node-fetch';

const RENDER_API_BASE = 'https://api.render.com/v1';
const API_TOKEN = 'rnd_hEvISDVyZ2dH69asjogK2yneRJEA';
const OWNER_ID = 'tea-d34ogobe5dus739qehjg';

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
const REGION = 'oregon';
const PLAN = 'free'; // requires payment method on account

// Build commands for each service (monorepo: build root first, then app)
// All services use the same build script from rootDir: .
const BUILD_COMMANDS = {
  'clawd-bot': './build-render.sh',
  'clawd-worker': './build-render.sh',
  'clawd-admin': './build-render.sh',
  'clawd-website': './build-render.sh',
};

const START_COMMANDS = {
  'clawd-bot': 'node apps/bot/dist/main.js',
  'clawd-worker': 'node apps/worker/dist/main.js',
  'clawd-admin': 'cd apps/admin && npm run start',
  'clawd-website': 'cd apps/website && npm run start',
};

// ──────────────────────────────────────────────────────────────────────────
// PAYLOAD BUILDERS (adapted from user's working pattern)
// ──────────────────────────────────────────────────────────────────────────

function buildNodeWebServicePayload(name, rootDir, healthCheckPath = '/api/health') {
  const serviceName = name.replace('clawd-', '');
  const publicUrl = `https://${name}.onrender.com`;

  return {
    name,
    ownerId: OWNER_ID,
    type: 'web_service',
    repo: REPO_URL,
    branch: BRANCH,
    rootDir,
    region: REGION,
    plan: PLAN,
    serviceDetails: {
      env: 'node',
      envSpecificDetails: {
        buildCommand: BUILD_COMMANDS[name],
        startCommand: START_COMMANDS[name],
      },
      runtime: 'node',
      numInstances: 1,
      plan: PLAN,
      region: REGION,
      healthCheckPath,
    },
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'NEXT_TELEMETRY_DISABLED', value: '1' },
      { key: 'RENDER_PUBLIC_URL', value: publicUrl },
    ],
  };
}

function buildNodeWorkerPayload(name, rootDir) {
  const serviceName = name.replace('clawd-', '');
  const publicUrl = `https://${name}.onrender.com`;

  return {
    name,
    ownerId: OWNER_ID,
    type: 'background_worker', // correct type for workers
    repo: REPO_URL,
    branch: BRANCH,
    rootDir,
    region: REGION,
    plan: PLAN,
    serviceDetails: {
      env: 'node',
      envSpecificDetails: {
        buildCommand: BUILD_COMMANDS[name],
        startCommand: START_COMMANDS[name],
      },
      runtime: 'node',
    },
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'LOG_LEVEL', value: 'info' },
      { key: 'RENDER_PUBLIC_URL', value: publicUrl },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Clawd Agents - Render API Deployment (Node.js services)     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    // 1. Databases already created - verify
    console.log('📦 Verifying databases...');
    const pg = await apiRequest('GET', `/postgres/dpg-daemqn6q1p3s73a13c10-a`);
    const redis = await apiRequest('GET', `/redis/red-daemsif40ujc73ft162g`);
    console.log(`✅ PostgreSQL: ${pg.name} (${pg.status})`);
    console.log(`✅ Redis: ${redis.name} (${redis.status})`);

    // 2. Create services
    console.log('\n🚀 Creating services...');

    const services = [
      { name: 'clawd-admin', payload: buildNodeWebServicePayload('clawd-admin', '.') },
      { name: 'clawd-website', payload: buildNodeWebServicePayload('clawd-website', '.') },
      { name: 'clawd-bot', payload: buildNodeWorkerPayload('clawd-bot', '.') },
      { name: 'clawd-worker', payload: buildNodeWorkerPayload('clawd-worker', '.') },
    ];

    const created = {};
    for (const { name, payload } of services) {
      console.log(`   Creating ${name}...`);
      try {
        const service = await apiRequest('POST', '/services', payload);
        created[name] = service;
        console.log(`   ✅ ${name}: ${service.id} (${service.serviceDetails?.url || 'pending URL'})`);
      } catch (err) {
        console.log(`   ❌ ${name}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // 3. Get URLs
    console.log('\n🔗 Getting service URLs...');
    for (const name of ['clawd-admin', 'clawd-website']) {
      if (created[name]) {
        const svc = await apiRequest('GET', `/services/${created[name].id}`);
        console.log(`   ${name}: ${svc.serviceDetails?.url}`);
      }
    }

    // 4. Update worker with actual URLs
    if (created['clawd-worker'] && created['clawd-admin'] && created['clawd-website']) {
      const adminSvc = await apiRequest('GET', `/services/${created['clawd-admin'].id}`);
      const websiteSvc = await apiRequest('GET', `/services/${created['clawd-website'].id}`);
      const adminUrl = adminSvc.serviceDetails?.url || 'https://clawd-admin.onrender.com';
      const websiteUrl = websiteSvc.serviceDetails?.url || 'https://clawd-website.onrender.com';

      console.log('\n🔧 Updating worker keep-alive URLs...');
      await apiRequest('PUT', `/services/${created['clawd-worker'].id}/env-vars`, {
        envVars: [
          { key: 'RENDER_ADMIN_URL', value: adminUrl },
          { key: 'RENDER_WEBSITE_URL', value: websiteUrl },
        ],
      });
      console.log(`   Admin URL: ${adminUrl}`);
      console.log(`   Website URL: ${websiteUrl}`);
    }

    // 5. Trigger deploys
    console.log('\n🚀 Triggering deploys...');
    for (const [name, service] of Object.entries(created)) {
      try {
        const deploy = await apiRequest('POST', `/services/${service.id}/deploys`, { clearCache: false });
        console.log(`   ${name}: deploy ${deploy.id} started`);
      } catch (err) {
        console.log(`   ❌ ${name}: ${err.message}`);
      }
    }

    console.log('\n⏳ Deploys triggered. Monitor in Render Dashboard.');
    console.log('   (First deploy takes 10-15 min for npm install + build)');

  } catch (error) {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  }
}

main();