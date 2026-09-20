import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postSummaryComment } from "../../../src/mcp-server/github/post-summary-comment.js";
import {
  GitHubAuthError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
} from "../../../src/mcp-server/errors.js";

const FAKE_TOKEN = "fake-token";

function mockFetchOnce(response: Partial<Response> & { ok: boolean; status: number }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({}),
      text: async () => "",
      headers: new Headers(),
      ...response,
    } as Response),
  );
}

describe("postSummaryComment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the issue-comments endpoint with the body as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 123, html_url: "https://github.com/octocat/hello-world/pull/42#issuecomment-123" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await postSummaryComment({ repo: "octocat/hello-world", pr_number: 42, body: "## Review\nlooks fine" }, FAKE_TOKEN);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/hello-world/issues/42/comments",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${FAKE_TOKEN}` }),
        body: JSON.stringify({ body: "## Review\nlooks fine" }),
      }),
    );
  });

  it("returns the posted comment's id and URL", async () => {
    mockFetchOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: 123, html_url: "https://github.com/octocat/hello-world/pull/42#issuecomment-123" }),
    });

    const result = await postSummaryComment({ repo: "octocat/hello-world", pr_number: 42, body: "x" }, FAKE_TOKEN);

    expect(result).toEqual({ id: 123, htmlUrl: "https://github.com/octocat/hello-world/pull/42#issuecomment-123" });
  });

  it("throws GitHubNotFoundError when the PR does not exist", async () => {
    mockFetchOnce({ ok: false, status: 404 });

    await expect(
      postSummaryComment({ repo: "octocat/hello-world", pr_number: 9999, body: "x" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubNotFoundError);
  });

  it("throws GitHubAuthError when the token is rejected", async () => {
    mockFetchOnce({ ok: false, status: 403 });

    await expect(
      postSummaryComment({ repo: "octocat/hello-world", pr_number: 42, body: "x" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubAuthError);
  });

  it("throws GitHubAuthError on a plain 403 with no rate-limit signal", async () => {
    mockFetchOnce({ ok: false, status: 403, text: async () => "Resource not accessible by integration" });

    await expect(
      postSummaryComment({ repo: "octocat/hello-world", pr_number: 42, body: "x" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubAuthError);
  });

  it("throws GitHubRateLimitError on a 403 with x-ratelimit-remaining: 0", async () => {
    mockFetchOnce({ ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) });

    await expect(
      postSummaryComment({ repo: "octocat/hello-world", pr_number: 42, body: "x" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubRateLimitError);
  });

  it("throws GitHubRateLimitError on a 403 with a retry-after header (secondary rate limit)", async () => {
    mockFetchOnce({ ok: false, status: 403, headers: new Headers({ "retry-after": "60" }) });

    await expect(
      postSummaryComment({ repo: "octocat/hello-world", pr_number: 42, body: "x" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubRateLimitError);
  });

  it("throws GitHubNetworkError when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com")));

    await expect(
      postSummaryComment({ repo: "octocat/hello-world", pr_number: 42, body: "x" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubNetworkError);
  });
});
