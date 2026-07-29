import { EventEmitter } from "node:events";
import type { DomainEvents } from "./types.js";

type Listener<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => void;

/**
 * Typed pub/sub for domain events. In-process EventEmitter today; the shape
 * is intentionally narrow (on/off/emit) so it can be swapped for a Redis
 * pub/sub-backed implementation later without touching call sites.
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof DomainEvents>(event: K, listener: Listener<K>): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, payload);
  }
}

/** Process-wide singleton event bus shared by bot + worker. */
export const eventBus = new EventBus();
