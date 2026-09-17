import { describe, expect, it, vi } from "vitest";
import { makePrintReviewNode } from "../../../src/graph/nodes/print_review.js";
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

describe("print_review node", () => {
  it("prints the review text via the injected print function", async () => {
    const print = vi.fn();
    const node = makePrintReviewNode({ print });

    await node(baseState());

    expect(print).toHaveBeenCalledWith("## Code Review — verdict: APPROVE");
  });

  it("does not mutate state (it's a terminal side-effect node)", async () => {
    const print = vi.fn();
    const node = makePrintReviewNode({ print });

    const result = await node(baseState());

    expect(result).toEqual({});
  });
});
