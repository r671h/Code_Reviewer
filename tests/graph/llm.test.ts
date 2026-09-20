import { describe, expect, it } from "vitest";
import { extractGeminiRetryDelayMs } from "../../src/graph/llm.js";

function fetchError(status: number, errorDetails?: Array<{ "@type"?: string; retryDelay?: string }>) {
  return Object.assign(new Error("Error fetching from ..."), { status, errorDetails });
}

describe("extractGeminiRetryDelayMs", () => {
  it("parses the RetryInfo detail's retryDelay (seconds) into milliseconds on a 429", () => {
    const error = fetchError(429, [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "13s" }]);

    expect(extractGeminiRetryDelayMs(error)).toBe(13_000);
  });

  it("returns undefined for a non-429 error, even with a RetryInfo-shaped detail", () => {
    const error = fetchError(500, [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "13s" }]);

    expect(extractGeminiRetryDelayMs(error)).toBeUndefined();
  });

  it("returns undefined on a 429 with no errorDetails", () => {
    const error = fetchError(429);

    expect(extractGeminiRetryDelayMs(error)).toBeUndefined();
  });

  it("returns undefined on a 429 whose errorDetails has no RetryInfo entry", () => {
    const error = fetchError(429, [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure" }]);

    expect(extractGeminiRetryDelayMs(error)).toBeUndefined();
  });

  it("returns undefined for a plain (non-Gemini-shaped) error", () => {
    expect(extractGeminiRetryDelayMs(new Error("plain failure"))).toBeUndefined();
  });
});
