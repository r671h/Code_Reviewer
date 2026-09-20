import { describe, expect, it, vi } from "vitest";
import { ReviewTimeoutError, runWithTimeout } from "../../src/graph/timeout.js";

describe("runWithTimeout", () => {
  it("resolves with the wrapped promise's value when it finishes before the timeout", async () => {
    const result = await runWithTimeout(Promise.resolve("done"), 1000);

    expect(result).toBe("done");
  });

  it("propagates the original rejection when the promise fails before timing out", async () => {
    const boom = new Error("boom");

    await expect(runWithTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom);
  });

  it("rejects with ReviewTimeoutError once the deadline passes, instead of hanging", async () => {
    vi.useFakeTimers();
    try {
      const neverResolves = new Promise(() => {});

      const result = runWithTimeout(neverResolves, 5000);
      const assertion = expect(result).rejects.toBeInstanceOf(ReviewTimeoutError);

      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("includes the configured timeout in the error message", async () => {
    vi.useFakeTimers();
    try {
      const neverResolves = new Promise(() => {});

      const result = runWithTimeout(neverResolves, 5000);
      const assertion = expect(result).rejects.toThrow("5000ms");

      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
