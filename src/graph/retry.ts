export class RetryExhaustedError extends Error {
  readonly attempts: number;
  override readonly cause: unknown;

  constructor(attempts: number, cause: unknown) {
    super(`Failed after ${attempts} attempt(s): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.cause = cause;
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  onRetry?: (attempt: number, error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called with the failed error and the delay exponential backoff would
   * otherwise use. Return a longer delay (e.g. parsed from a 429's
   * Retry-After/RetryInfo) to wait that long instead; return `undefined`
   * to keep the default backoff delay.
   */
  retryDelayMs?: (error: unknown, defaultDelayMs: number) => number | undefined;
  /**
   * Return false for a permanent error (bad request, auth, billing) to stop
   * immediately instead of burning the remaining attempts on it. Defaults
   * to retrying everything.
   */
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Retries `fn` with exponential backoff. Throws {@link RetryExhaustedError}
 * (wrapping the last underlying error as `cause`) once `maxAttempts` is
 * reached, or as soon as `isRetryable` rejects an error — never silently
 * swallows the failure.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const backoffFactor = options.backoffFactor ?? 2;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      options.onRetry?.(attempt, error);
      if (attempt >= maxAttempts || options.isRetryable?.(error) === false) {
        throw new RetryExhaustedError(attempt, error);
      }
      const backoffDelayMs = initialDelayMs * backoffFactor ** (attempt - 1);
      const delayMs = options.retryDelayMs?.(error, backoffDelayMs) ?? backoffDelayMs;
      await sleep(delayMs);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
