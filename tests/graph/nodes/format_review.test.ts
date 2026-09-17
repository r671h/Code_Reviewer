import { describe, expect, it } from "vitest";
import { format_review } from "../../../src/graph/nodes/format_review.js";
import type { GraphStateType } from "../../../src/graph/state.js";

function baseState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    files: [],
    fileContexts: [],
    issues: [],
    fileErrors: [],
    verdict: "COMMENT",
    reviewText: undefined,
    ...overrides,
  };
}

describe("format_review node", () => {
  it("includes the verdict and each issue grouped under its file", () => {
    const state = baseState({
      verdict: "REQUEST_CHANGES",
      issues: [
        { file: "src/foo.ts", line: 12, severity: "critical", category: "bug", explanation: "null deref" },
        { file: "src/bar.ts", line: 5, severity: "info", category: "n_plus_one", explanation: "loop query" },
      ],
    });

    const result = format_review(state);

    expect(result.reviewText).toContain("REQUEST_CHANGES");
    expect(result.reviewText).toContain("src/foo.ts");
    expect(result.reviewText).toContain("null deref");
    expect(result.reviewText).toContain("src/bar.ts");
    expect(result.reviewText).toContain("loop query");
  });

  it("lists files that could not be analyzed, without hiding the failure", () => {
    const state = baseState({
      issues: [{ file: "src/foo.ts", line: 1, severity: "warning", category: "style", explanation: "nit" }],
      fileErrors: [{ path: "src/broken.ts", stage: "analyze", message: "model unavailable" }],
    });

    const result = format_review(state);

    expect(result.reviewText).toContain("src/broken.ts");
    expect(result.reviewText).toContain("model unavailable");
  });
});
