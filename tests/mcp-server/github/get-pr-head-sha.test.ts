import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrHeadSha } from "../../../src/mcp-server/github/get-pr-head-sha.js";
import {
  GitHubAuthError,
  GitHubNetworkError,
  GitHubNotFoundError,
  GitHubRateLimitError,
} from "../../../src/mcp-server/errors.js";

const FAKE_TOKEN = "fake-token";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

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

describe("getPrHeadSha", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the PR as JSON from the pulls endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ head: { sha: HEAD_SHA } }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await getPrHeadSha({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/hello-world/pulls/42",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${FAKE_TOKEN}`,
          Accept: "application/vnd.github+json",
        }),
      }),
    );
  });

  it("returns the head commit SHA", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ head: { sha: HEAD_SHA }, title: "x" }) });

    const sha = await getPrHeadSha({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN);

    expect(sha).toBe(HEAD_SHA);
  });

  it("throws GitHubNetworkError when the response has no head SHA", async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ head: {} }) });

    await expect(getPrHeadSha({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubNetworkError,
    );
  });

  it("throws GitHubNotFoundError when the PR does not exist", async () => {
    mockFetchOnce({ ok: false, status: 404 });

    await expect(getPrHeadSha({ repo: "octocat/hello-world", pr_number: 9999 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubNotFoundError,
    );
  });

  it("throws GitHubAuthError when the token is rejected", async () => {
    mockFetchOnce({ ok: false, status: 401 });

    await expect(getPrHeadSha({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubAuthError,
    );
  });

  it("throws GitHubRateLimitError on a 403 with x-ratelimit-remaining: 0", async () => {
    mockFetchOnce({ ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) });

    await expect(getPrHeadSha({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubRateLimitError,
    );
  });

  it("throws GitHubNetworkError when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com")));

    await expect(getPrHeadSha({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubNetworkError,
    );
  });
});
