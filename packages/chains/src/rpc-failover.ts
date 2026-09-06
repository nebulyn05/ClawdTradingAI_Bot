import { createLogger } from "@clawd/core";

const log = createLogger("chains:rpc-failover");

/** Splits a comma-separated env value into a clean list of non-empty URLs. */
export function parseRpcUrlList(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Wraps a list of same-shaped RPC client instances (primary first, then
 * fallbacks) in a Proxy: calling any method named in `methods` tries each
 * instance in order until one succeeds, logging every failed attempt and
 * whenever a non-primary instance ends up serving the request — so a
 * degraded primary shows up in logs instead of being silently masked by a
 * healthy fallback. Every other property/method passes straight through to
 * the primary instance unchanged.
 *
 * Deliberately scoped to `methods` rather than wrapping every function on
 * the instance: a live subscription (e.g. Solana's Connection.onLogs) is
 * bound to one specific instance's transport and returns a subscription id
 * synchronously, not a promise — retrying it across instances or awaiting
 * its return value would be wrong. Only genuinely one-shot, retryable
 * request methods belong in `methods`.
 */
export function withRpcFailover<T extends object>(
  instances: T[],
  methods: readonly (keyof T)[],
  label: string,
  endpointOf: (instance: T) => string,
): T {
  const primary = instances[0];
  if (!primary || instances.length <= 1) return primary as T;

  const methodSet = new Set<keyof T>(methods);

  return new Proxy(primary, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && methodSet.has(prop as keyof T)) {
        return async (...args: unknown[]) => {
          let lastErr: unknown;
          for (const [i, instance] of instances.entries()) {
            try {
              const fn = instance[prop as keyof T] as unknown as (...a: unknown[]) => unknown;
              const result = await fn.apply(instance, args);
              if (i > 0) {
                log.warn(
                  { label, endpoint: endpointOf(instance), method: prop, attempt: i + 1, of: instances.length },
                  "RPC request served by a fallback provider — primary is degraded/down",
                );
              }
              return result;
            } catch (err) {
              lastErr = err;
              log.warn(
                { label, endpoint: endpointOf(instance), method: prop, attempt: i + 1, of: instances.length, err },
                "RPC provider failed — trying next",
              );
            }
          }
          throw lastErr;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}
