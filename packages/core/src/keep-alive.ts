/**
 * Keep-alive utility for Render free tier web services.
 *
 * Render spins down free tier web services after 15 minutes of inactivity.
 * Since background workers DON'T spin down on free tier, we can use the
 * worker process to periodically ping the web service health endpoints.
 *
 * This module is designed to be imported and started from apps/worker/src/main.ts
 */

import { eventBus } from './event-bus.js';

interface KeepAliveConfig {
  /** URLs to ping (e.g., https://clawd-admin.onrender.com/api/health) */
  urls: string[];
  /** Interval between pings in milliseconds (default: 10 minutes) */
  intervalMs: number;
  /** Timeout for each ping request (default: 30 seconds) */
  timeoutMs: number;
  /** Whether to log each ping result (default: false - only log failures) */
  verbose: boolean;
}

const DEFAULT_CONFIG: KeepAliveConfig = {
  urls: [],
  intervalMs: 10 * 60 * 1000, // 10 minutes (well under Render's 15-minute timeout)
  timeoutMs: 30 * 1000,
  verbose: false,
};

let config: KeepAliveConfig = DEFAULT_CONFIG;
let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Configure and start the keep-alive pinger.
 * Call this once during worker startup.
 */
export function startKeepAlive(userConfig: Partial<KeepAliveConfig> = {}): void {
  if (isRunning) {
    console.log('[keep-alive] Already running, ignoring duplicate start');
    return;
  }

  config = { ...DEFAULT_CONFIG, ...userConfig };

  if (config.urls.length === 0) {
    console.log('[keep-alive] No URLs configured, keep-alive disabled');
    return;
  }

  console.log(
    `[keep-alive] Starting — will ping ${config.urls.length} URL(s) every ${config.intervalMs / 60000} minutes`
  );

  // Run immediately on startup
  pingAll();

  // Then schedule recurring
  intervalId = setInterval(pingAll, config.intervalMs);
  isRunning = true;

  // Emit event for monitoring
  eventBus.emit('keepAlive.started', { urls: config.urls, intervalMs: config.intervalMs });
}

/**
 * Stop the keep-alive pinger (for graceful shutdown).
 */
export function stopKeepAlive(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  isRunning = false;
  console.log('[keep-alive] Stopped');
  eventBus.emit('keepAlive.stopped', {});
}

/**
 * Ping all configured URLs.
 */
async function pingAll(): Promise<void> {
  const results = await Promise.allSettled(
    config.urls.map((url) => pingUrl(url))
  );

  const failures = results
    .map((r, i) => (r.status === 'rejected' ? config.urls[i] : null))
    .filter((url): url is string => url !== null);

  if (failures.length > 0) {
    console.warn(`[keep-alive] ${failures.length}/${config.urls.length} ping(s) failed:`, failures);
    eventBus.emit('keepAlive.failures', { failedUrls: failures });
  } else if (config.verbose) {
    console.log(`[keep-alive] All ${config.urls.length} ping(s) successful`);
  }

  eventBus.emit('keepAlive.tick', {
    total: config.urls.length,
    failed: failures.length,
    failedUrls: failures,
  });
}

/**
 * Ping a single URL with timeout.
 */
async function pingUrl(url: string): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'clawd-keep-alive/1.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    // Optionally parse JSON to verify the endpoint returns valid data
    // const data = await response.json();
    // if (data.status !== 'healthy') throw new Error(`Unhealthy status: ${data.status}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get current keep-alive status (for admin dashboard / debugging).
 */
export function getKeepAliveStatus(): {
  running: boolean;
  config: KeepAliveConfig;
} {
  return {
    running: isRunning,
    config: { ...config },
  };
}

/**
 * Update keep-alive URLs at runtime (e.g., via admin action).
 * Restarts the interval with new config.
 */
export function updateKeepAliveUrls(newUrls: string[]): void {
  const wasRunning = isRunning;
  if (wasRunning) stopKeepAlive();
  config = { ...config, urls: newUrls };
  if (wasRunning && newUrls.length > 0) startKeepAlive();
}