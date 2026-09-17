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
}

/**
 * Retries `fn` with exponential backoff. Throws {@link RetryExhaustedError}
 * (wrapping the last underlying error as `cause`) once `maxAttempts` is
 * reached — never silently swallows the failure.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const backoffFactor = options.backoffFactor ?? 2;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      options.onRetry?.(attempt, error);
      if (attempt === maxAttempts) break;
      await sleep(initialDelayMs * backoffFactor ** (attempt - 1));
    }
  }

  throw new RetryExhaustedError(maxAttempts, lastError);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
