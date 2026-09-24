type AsyncFn<T> = () => Promise<T>;

export class AsyncRateLimiter {
  private readonly intervalMs: number;
  private nextAllowedAt = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(requestsPerSecond = 8) {
    this.intervalMs = 1000 / Math.max(1, requestsPerSecond);
  }

  async run<T>(fn: AsyncFn<T>): Promise<T> {
    const execute = async () => {
      const waitMs = Math.max(0, this.nextAllowedAt - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.nextAllowedAt = Date.now() + this.intervalMs;
      return fn();
    };

    const result = this.tail.then(execute, execute);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function isRpcRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|too many requests|rate limit|rate limit exceeded|requests per second/i.test(message);
}

export async function withRpcRetry<T>(
  operation: () => Promise<T>,
  limiter: AsyncRateLimiter,
  maxAttempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await limiter.run(operation);
    } catch (error) {
      lastError = error;
      if (!isRpcRateLimitError(error) || attempt === maxAttempts) throw error;
      const baseDelay = 1000 * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
    }
  }
  throw lastError;
}
