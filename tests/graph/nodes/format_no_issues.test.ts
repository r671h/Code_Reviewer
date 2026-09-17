import { describe, expect, it } from "vitest";
import { format_no_issues } from "../../../src/graph/nodes/format_no_issues.js";
import type { GraphStateType } from "../../../src/graph/state.js";

function baseState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    files: [{ path: "src/foo.ts", patch: "+x", changedLines: [1] }],
    fileContexts: [],
    issues: [],
    fileErrors: [],
    verdict: "APPROVE",
    reviewText: undefined,
    ...overrides,
  };
}

describe("format_no_issues node", () => {
  it("reports approval and the number of files reviewed", () => {
    const result = format_no_issues(baseState());

    expect(result.reviewText).toContain("APPROVE");
    expect(result.reviewText).toContain("1 file");
  });

  it("still surfaces file errors even when no issues were found", () => {
    const result = format_no_issues(
      baseState({ fileErrors: [{ path: "src/broken.ts", stage: "fetch_context", message: "not found" }] }),
    );

    expect(result.reviewText).toContain("src/broken.ts");
    expect(result.reviewText).toContain("not found");
  });

  it("handles an empty diff (0 files reviewed) without fabricating anything", () => {
    const result = format_no_issues(baseState({ files: [] }));

    expect(result.reviewText).toContain("APPROVE");
    expect(result.reviewText).toContain("0 file");
    expect(result.reviewText).not.toMatch(/issue(?!s found)/i);
  });
});
