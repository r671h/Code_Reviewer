import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrDiff } from "../../../src/mcp-server/github/get-pr-diff.js";
import { GitHubAuthError, GitHubNetworkError, GitHubNotFoundError } from "../../../src/mcp-server/errors.js";

const FAKE_TOKEN = "fake-token";

function mockFetchOnce(response: Partial<Response> & { ok: boolean; status: number }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      text: async () => "",
      ...response,
    } as Response),
  );
}

describe("getPrDiff", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the unified diff text for a successful response", async () => {
    const diffText = "diff --git a/foo.ts b/foo.ts\n+added line\n";
    mockFetchOnce({ ok: true, status: 200, text: async () => diffText });

    const result = await getPrDiff({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN);

    expect(result).toBe(diffText);
  });

  it("requests the diff media type from the correct PR URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "diff",
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await getPrDiff({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/hello-world/pulls/42",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github.v3.diff",
          Authorization: `Bearer ${FAKE_TOKEN}`,
        }),
      }),
    );
  });

  it("throws GitHubNotFoundError when the PR does not exist", async () => {
    mockFetchOnce({ ok: false, status: 404 });

    await expect(getPrDiff({ repo: "octocat/hello-world", pr_number: 9999 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubNotFoundError,
    );
  });

  it("throws GitHubAuthError when the token is rejected", async () => {
    mockFetchOnce({ ok: false, status: 401 });

    await expect(getPrDiff({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubAuthError,
    );
  });

  it("throws GitHubNetworkError when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com")),
    );

    await expect(getPrDiff({ repo: "octocat/hello-world", pr_number: 42 }, FAKE_TOKEN)).rejects.toThrow(
      GitHubNetworkError,
    );
  });
});
