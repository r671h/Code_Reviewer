import { describe, expect, it } from "vitest";
import { isGitHubRateLimited } from "../../../src/mcp-server/github/classify-403.js";

function response(headers: Record<string, string> = {}): Response {
  return { headers: new Headers(headers) } as Response;
}

describe("isGitHubRateLimited", () => {
  it("is true when x-ratelimit-remaining is 0 (primary rate limit)", () => {
    expect(isGitHubRateLimited(response({ "x-ratelimit-remaining": "0" }), "")).toBe(true);
  });

  it("is true when a retry-after header is present (secondary/abuse-detection rate limit)", () => {
    expect(isGitHubRateLimited(response({ "retry-after": "30" }), "")).toBe(true);
  });

  it("is true when the body mentions 'rate limit', case-insensitively", () => {
    expect(isGitHubRateLimited(response(), "API rate limit exceeded for user ID 12345.")).toBe(true);
    expect(isGitHubRateLimited(response(), "You have exceeded a secondary RATE LIMIT.")).toBe(true);
  });

  it("is false for a plain 403 with no rate-limit signal (real auth/permission failure)", () => {
    expect(isGitHubRateLimited(response(), "Resource not accessible by integration")).toBe(false);
  });

  it("is false when x-ratelimit-remaining is present but non-zero", () => {
    expect(isGitHubRateLimited(response({ "x-ratelimit-remaining": "42" }), "")).toBe(false);
  });

  it("is false for an empty body and no headers at all", () => {
    expect(isGitHubRateLimited(response(), "")).toBe(false);
  });
});
