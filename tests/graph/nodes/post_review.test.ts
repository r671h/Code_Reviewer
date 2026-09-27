import { describe, expect, it, vi } from "vitest";
import { makePostReviewNode, REVIEW_MARKER } from "../../../src/graph/nodes/post_review.js";
import type { GraphStateType } from "../../../src/graph/state.js";
import { GitHubAuthError, GitHubNetworkError, GitHubNotFoundError } from "../../../src/mcp-server/errors.js";

function baseState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    headSha: undefined,
    files: [],
    fileContexts: [],
    issues: [],
    fileErrors: [],
    verdict: "APPROVE",
    reviewText: "## Code Review — verdict: APPROVE",
    ...overrides,
  };
}

const EXPECTED_BODY = `## Code Review — verdict: APPROVE\n\n${REVIEW_MARKER}`;

function fakeDeps(existing?: { id: number; htmlUrl: string }) {
  return {
    postSummaryComment: vi.fn().mockResolvedValue({ id: 1, htmlUrl: "https://example.com/1" }),
    findSummaryComment: vi.fn().mockResolvedValue(existing),
    updateSummaryComment: vi.fn().mockResolvedValue(existing ?? { id: 0, htmlUrl: "" }),
    githubToken: "fake-token",
  };
}

describe("post_review node", () => {
  it("marks the review with a hidden HTML comment so a later run can find it", () => {
    expect(REVIEW_MARKER).toMatch(/^<!--.*-->$/);
  });

  it("looks for an earlier review on the PR by its marker", async () => {
    const deps = fakeDeps();
    const node = makePostReviewNode(deps);

    await node(baseState());

    expect(deps.findSummaryComment).toHaveBeenCalledWith(
      { repo: "octocat/hello-world", pr_number: 42, marker: REVIEW_MARKER },
      "fake-token",
    );
  });

  it("posts a new comment (review text + marker) when no earlier review exists", async () => {
    const deps = fakeDeps();
    const node = makePostReviewNode(deps);

    await node(baseState());

    expect(deps.postSummaryComment).toHaveBeenCalledWith(
      { repo: "octocat/hello-world", pr_number: 42, body: EXPECTED_BODY },
      "fake-token",
    );
    expect(deps.updateSummaryComment).not.toHaveBeenCalled();
  });

  it("updates the earlier review in place instead of posting a duplicate", async () => {
    const deps = fakeDeps({ id: 77, htmlUrl: "https://example.com/77" });
    const node = makePostReviewNode(deps);

    await node(baseState());

    expect(deps.updateSummaryComment).toHaveBeenCalledWith(
      { repo: "octocat/hello-world", comment_id: 77, body: EXPECTED_BODY },
      "fake-token",
    );
    expect(deps.postSummaryComment).not.toHaveBeenCalled();
  });

  it("falls back to posting a new comment when the marked comment can't be edited (e.g. someone else's)", async () => {
    const deps = fakeDeps({ id: 77, htmlUrl: "https://example.com/77" });
    deps.updateSummaryComment.mockRejectedValue(new GitHubAuthError("forbidden"));
    const node = makePostReviewNode(deps);

    await node(baseState());

    expect(deps.postSummaryComment).toHaveBeenCalledWith(
      { repo: "octocat/hello-world", pr_number: 42, body: EXPECTED_BODY },
      "fake-token",
    );
  });

  it("falls back to posting a new comment when the marked comment was deleted in between", async () => {
    const deps = fakeDeps({ id: 77, htmlUrl: "https://example.com/77" });
    deps.updateSummaryComment.mockRejectedValue(new GitHubNotFoundError("gone"));
    const node = makePostReviewNode(deps);

    await node(baseState());

    expect(deps.postSummaryComment).toHaveBeenCalledTimes(1);
  });

  it("propagates other update failures instead of posting a duplicate", async () => {
    const deps = fakeDeps({ id: 77, htmlUrl: "https://example.com/77" });
    deps.updateSummaryComment.mockRejectedValue(new GitHubNetworkError("boom"));
    const node = makePostReviewNode(deps);

    await expect(node(baseState())).rejects.toThrow(GitHubNetworkError);
    expect(deps.postSummaryComment).not.toHaveBeenCalled();
  });

  it("does not mutate state (it's a terminal side-effect node)", async () => {
    const node = makePostReviewNode(fakeDeps());

    const result = await node(baseState());

    expect(result).toEqual({});
  });

  it("propagates a posting failure rather than swallowing it", async () => {
    const deps = fakeDeps();
    deps.postSummaryComment.mockRejectedValue(new Error("rate limited"));
    const node = makePostReviewNode(deps);

    await expect(node(baseState())).rejects.toThrow("rate limited");
  });

  it("propagates a lookup failure rather than posting blind", async () => {
    const deps = fakeDeps();
    deps.findSummaryComment.mockRejectedValue(new GitHubNetworkError("boom"));
    const node = makePostReviewNode(deps);

    await expect(node(baseState())).rejects.toThrow(GitHubNetworkError);
    expect(deps.postSummaryComment).not.toHaveBeenCalled();
  });
});
