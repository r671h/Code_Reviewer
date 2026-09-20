export class ReviewTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Review timed out after ${timeoutMs}ms (REVIEW_TIMEOUT_MS)`);
    this.name = "ReviewTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Races `promise` against a `timeoutMs` deadline. Rejects with
 * {@link ReviewTimeoutError} if the deadline passes first, so a hung
 * graph run fails explicitly instead of leaving the CI job to hang until
 * the runner's own timeout kills it.
 */
export function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReviewTimeoutError(timeoutMs)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
