import { describe, expect, it, vi } from "vitest";
import { RetryExhaustedError, withRetry } from "../../src/graph/retry.js";

describe("withRetry", () => {
  it("returns the result on first success, without retrying", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(operation);

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries failed operations and returns the result once a later attempt succeeds", async () => {
    let attempts = 0;
    const operation = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient failure");
      return "success";
    };

    const result = await withRetry(operation, { sleep: async () => {} });

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("throws RetryExhaustedError after maxAttempts consecutive failures", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("persistent failure"));

    await expect(withRetry(operation, { maxAttempts: 3, sleep: async () => {} })).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("preserves the last underlying error as the cause", async () => {
    const finalError = new Error("final failure");
    const operation = vi.fn().mockRejectedValue(finalError);

    const caught = await withRetry(operation, { maxAttempts: 2, sleep: async () => {} }).catch((e) => e);

    expect(caught).toBeInstanceOf(RetryExhaustedError);
    expect((caught as RetryExhaustedError).cause).toBe(finalError);
  });

  it("waits with exponential backoff between attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockRejectedValue(new Error("fail"));

    await withRetry(operation, { maxAttempts: 3, initialDelayMs: 500, backoffFactor: 2, sleep }).catch(() => {});

    expect(sleep).toHaveBeenNthCalledWith(1, 500);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  it("calls onRetry with the attempt number and error for each failed attempt", async () => {
    const onRetry = vi.fn();
    const operation = vi.fn().mockRejectedValue(new Error("fail"));

    await withRetry(operation, { maxAttempts: 2, sleep: async () => {}, onRetry }).catch(() => {});

    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
  });

  it("uses retryDelayMs's suggested delay instead of the exponential backoff when it returns one", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockRejectedValue(new Error("rate limited"));
    const retryDelayMs = vi.fn().mockReturnValue(13_000);

    await withRetry(operation, { maxAttempts: 2, initialDelayMs: 500, backoffFactor: 2, sleep, retryDelayMs }).catch(
      () => {},
    );

    expect(retryDelayMs).toHaveBeenCalledWith(expect.any(Error), 500);
    expect(sleep).toHaveBeenCalledWith(13_000);
  });

  it("falls back to the exponential backoff delay when retryDelayMs returns undefined", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi.fn().mockRejectedValue(new Error("ordinary failure"));
    const retryDelayMs = vi.fn().mockReturnValue(undefined);

    await withRetry(operation, { maxAttempts: 2, initialDelayMs: 500, backoffFactor: 2, sleep, retryDelayMs }).catch(
      () => {},
    );

    expect(sleep).toHaveBeenCalledWith(500);
  });
});
