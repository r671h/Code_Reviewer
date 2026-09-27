import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSummaryComment } from "../../../src/mcp-server/github/find-summary-comment.js";
import { GitHubAuthError, GitHubNetworkError, GitHubNotFoundError } from "../../../src/mcp-server/errors.js";

const FAKE_TOKEN = "fake-token";
const MARKER = "<!-- codereviewer -->";

interface FakeComment {
  id: number;
  html_url: string;
  body: string;
}

function comment(id: number, body: string): FakeComment {
  return { id, html_url: `https://github.com/octocat/hello-world/pull/42#issuecomment-${id}`, body };
}

function jsonOk(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data, text: async () => "", headers: new Headers() } as Response;
}

function status(code: number): Response {
  return { ok: false, status: code, json: async () => ({}), text: async () => "", headers: new Headers() } as Response;
}

const INPUT = { repo: "octocat/hello-world", pr_number: 42, marker: MARKER };

describe("findSummaryComment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the PR's issue comments, 100 per page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk([]));
    vi.stubGlobal("fetch", fetchMock);

    await findSummaryComment(INPUT, FAKE_TOKEN);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/hello-world/issues/42/comments?per_page=100&page=1",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${FAKE_TOKEN}` }) }),
    );
  });

  it("returns undefined when no comment contains the marker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk([comment(1, "LGTM"), comment(2, "nit: rename")])));

    expect(await findSummaryComment(INPUT, FAKE_TOKEN)).toBeUndefined();
  });

  it("returns the id and URL of the comment containing the marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonOk([comment(1, "LGTM"), comment(2, `## Code Review\n\n${MARKER}`)])),
    );

    expect(await findSummaryComment(INPUT, FAKE_TOKEN)).toEqual({
      id: 2,
      htmlUrl: "https://github.com/octocat/hello-world/pull/42#issuecomment-2",
    });
  });

  it("returns the most recent match when several comments carry the marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonOk([comment(1, `old ${MARKER}`), comment(2, "LGTM"), comment(3, `new ${MARKER}`)])),
    );

    expect((await findSummaryComment(INPUT, FAKE_TOKEN))?.id).toBe(3);
  });

  it("follows pagination until a short page, finding a marker on a later page", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => comment(i + 1, "chatter"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonOk(fullPage))
      .mockResolvedValueOnce(jsonOk([comment(101, `review ${MARKER}`)]));
    vi.stubGlobal("fetch", fetchMock);

    const found = await findSummaryComment(INPUT, FAKE_TOKEN);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("page=2");
    expect(found?.id).toBe(101);
  });

  it("tolerates comments with a null body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonOk([{ id: 1, html_url: "https://x", body: null }, comment(2, MARKER)])),
    );

    expect((await findSummaryComment(INPUT, FAKE_TOKEN))?.id).toBe(2);
  });

  it("throws GitHubNetworkError when the response isn't a comment list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonOk({ message: "weird" })));

    await expect(findSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubNetworkError);
  });

  it("throws GitHubNotFoundError when the PR does not exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(status(404)));

    await expect(findSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubNotFoundError);
  });

  it("throws GitHubAuthError when the token is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(status(401)));

    await expect(findSummaryComment(INPUT, FAKE_TOKEN)).rejects.toThrow(GitHubAuthError);
  });
});
