import { Redis } from "ioredis";
import { eventBus } from "./event-bus.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import type { DomainEvents } from "./types.js";

const log = createLogger("core:redis-bridge");
const CHANNEL_PREFIX = "clawd:events:";

/**
 * The event bus (event-bus.ts) is a single process's in-memory EventEmitter —
 * it does NOT cross process boundaries. The bot and worker are separate
 * Node processes, so a worker-side `eventBus.emit(...)` is invisible to the
 * bot unless bridged. These two functions do that bridging over Redis
 * pub/sub: the worker publishes the events it produces, the bot subscribes
 * and re-emits them on its own local bus for its notification handlers.
 */
export function startPublishingToRedis(events: (keyof DomainEvents)[]): () => void {
  const { REDIS_URL } = loadConfig();
  const pub = new Redis(REDIS_URL, { lazyConnect: true });
  pub.connect().catch((err) => log.error({ err }, "Redis publisher failed to connect"));

  const unsubs = events.map((event) =>
    eventBus.on(event, (payload) => {
      pub.publish(`${CHANNEL_PREFIX}${event}`, JSON.stringify(payload)).catch((err) =>
        log.warn({ err, event }, "Failed to publish event to Redis"),
      );
    }),
  );

  return () => {
    unsubs.forEach((unsub) => unsub());
    pub.disconnect();
  };
}

export function startSubscribingToRedis(events: (keyof DomainEvents)[]): () => void {
  const { REDIS_URL } = loadConfig();
  const sub = new Redis(REDIS_URL, { lazyConnect: true });
  const channels = events.map((event) => `${CHANNEL_PREFIX}${event}`);

  sub
    .connect()
    .then(() => sub.subscribe(...channels))
    .catch((err) => log.error({ err }, "Redis subscriber failed to connect/subscribe"));

  sub.on("message", (channel, message) => {
    const event = channel.slice(CHANNEL_PREFIX.length) as keyof DomainEvents;
    try {
      eventBus.emit(event, JSON.parse(message));
    } catch (err) {
      log.warn({ err, channel }, "Failed to parse event payload from Redis");
    }
  });

  return () => {
    sub.disconnect();
  };
}
