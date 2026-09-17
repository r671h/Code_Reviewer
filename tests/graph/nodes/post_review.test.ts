import { describe, expect, it, vi } from "vitest";
import { makePostReviewNode } from "../../../src/graph/nodes/post_review.js";
import type { GraphStateType } from "../../../src/graph/state.js";

function baseState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    files: [],
    fileContexts: [],
    issues: [],
    fileErrors: [],
    verdict: "APPROVE",
    reviewText: "## Code Review — verdict: APPROVE",
    ...overrides,
  };
}

describe("post_review node", () => {
  it("posts the review text to the PR the state points at", async () => {
    const postSummaryComment = vi.fn().mockResolvedValue({ id: 1, htmlUrl: "https://example.com/1" });
    const node = makePostReviewNode({ postSummaryComment, githubToken: "fake-token" });

    await node(baseState());

    expect(postSummaryComment).toHaveBeenCalledWith(
      { repo: "octocat/hello-world", pr_number: 42, body: "## Code Review — verdict: APPROVE" },
      "fake-token",
    );
  });

  it("does not mutate state (it's a terminal side-effect node)", async () => {
    const postSummaryComment = vi.fn().mockResolvedValue({ id: 1, htmlUrl: "https://example.com/1" });
    const node = makePostReviewNode({ postSummaryComment, githubToken: "fake-token" });

    const result = await node(baseState());

    expect(result).toEqual({});
  });

  it("propagates a posting failure rather than swallowing it", async () => {
    const postSummaryComment = vi.fn().mockRejectedValue(new Error("rate limited"));
    const node = makePostReviewNode({ postSummaryComment, githubToken: "fake-token" });

    await expect(node(baseState())).rejects.toThrow("rate limited");
  });
});
