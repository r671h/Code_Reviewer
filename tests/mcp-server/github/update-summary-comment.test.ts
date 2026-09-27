import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSummaryComment } from "../../../src/mcp-server/github/update-summary-comment.js";
import {
  GitHubAuthError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
} from "../../../src/mcp-server/errors.js";

const FAKE_TOKEN = "fake-token";
const INPUT = { repo: "octocat/hello-world", comment_id: 123, body: "## Review\nupdated" };

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

describe("updateSummaryComment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes the issue comment with the new body as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 123, html_url: "https://github.com/octocat/hello-world/pull/42#issuecomment-123" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await updateSummaryComment(INPUT, FAKE_TOKEN);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/hello-world/issues/comments/123",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: `Bearer ${FAKE_TOKEN}` }),
        body: JSON.stringify({ body: "## Review\nupdated" }),
      }),
    );
  });

  it("returns the updated comment's id and URL", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 123, html_url: "https://github.com/octocat/hello-world/pull/42#issuecomment-123" }),
    });

    expect(await updateSummaryComment(INPUT, FAKE_TOKEN)).toEqual({
      id: 123,
      htmlUrl: "https://github.com/octocat/hello-world/pull/42#issuecomment-123",
    });
  });

  it("throws GitHubNetworkError when the response isn't a comment", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ unexpected: true }) });

    await expect(updateSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubNetworkError);
  });

  it("throws GitHubNotFoundError when the comment no longer exists", async () => {
    mockFetchOnce({ ok: false, status: 404 });

    await expect(updateSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubNotFoundError);
  });

  it("throws GitHubAuthError when the token may not edit the comment", async () => {
    mockFetchOnce({ ok: false, status: 403, text: async () => "Resource not accessible by integration" });

    await expect(updateSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubAuthError);
  });

  it("throws GitHubRateLimitError on a 403 with x-ratelimit-remaining: 0", async () => {
    mockFetchOnce({ ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) });

    await expect(updateSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubRateLimitError);
  });

  it("throws GitHubNetworkError when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));

    await expect(updateSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubNetworkError);
  });
});
