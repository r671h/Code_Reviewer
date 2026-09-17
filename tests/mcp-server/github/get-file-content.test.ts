import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFileContent } from "../../../src/mcp-server/github/get-file-content.js";
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

describe("getFileContent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the raw file content for a successful response", async () => {
    const fileText = "export const answer = 42;\n";
    mockFetchOnce({ ok: true, status: 200, text: async () => fileText });

    const result = await getFileContent(
      { repo: "octocat/hello-world", path: "src/index.ts" },
      FAKE_TOKEN,
    );

    expect(result).toBe(fileText);
  });

  it("requests the raw content media type from the correct contents URL, with ref as a query param", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "content",
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await getFileContent(
      { repo: "octocat/hello-world", path: "src/index.ts", ref: "main" },
      FAKE_TOKEN,
    );

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    expect(String(calledUrl)).toBe(
      "https://api.github.com/repos/octocat/hello-world/contents/src/index.ts?ref=main",
    );
    expect(calledInit.headers).toMatchObject({
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${FAKE_TOKEN}`,
    });
  });

  it("URL-encodes path segments", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "content",
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await getFileContent({ repo: "octocat/hello-world", path: "src/my file.ts" }, FAKE_TOKEN);

    const [calledUrl] = fetchMock.mock.calls[0] as [URL | string, RequestInit];
    expect(String(calledUrl)).toBe(
      "https://api.github.com/repos/octocat/hello-world/contents/src/my%20file.ts",
    );
  });

  it("throws GitHubNotFoundError when the file does not exist", async () => {
    mockFetchOnce({ ok: false, status: 404 });

    await expect(
      getFileContent({ repo: "octocat/hello-world", path: "missing.ts" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubNotFoundError);
  });

  it("throws GitHubAuthError when the token is rejected", async () => {
    mockFetchOnce({ ok: false, status: 401 });

    await expect(
      getFileContent({ repo: "octocat/hello-world", path: "src/index.ts" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubAuthError);
  });

  it("throws GitHubNetworkError when the request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com")),
    );

    await expect(
      getFileContent({ repo: "octocat/hello-world", path: "src/index.ts" }, FAKE_TOKEN),
    ).rejects.toThrow(GitHubNetworkError);
  });
});
