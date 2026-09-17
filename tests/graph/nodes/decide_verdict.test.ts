import { describe, expect, it } from "vitest";
import { decide_verdict } from "../../../src/graph/nodes/decide_verdict.js";
import type { GraphStateType } from "../../../src/graph/state.js";
import type { Issue } from "../../../src/schemas/review.js";

function baseState(issues: Issue[]): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    files: [],
    fileContexts: [],
    issues,
    fileErrors: [],
    verdict: undefined,
    reviewText: undefined,
  };
}

const issue = (severity: Issue["severity"]): Issue => ({
  file: "a.ts",
  line: 1,
  severity,
  category: "bug",
  explanation: "x",
});

describe("decide_verdict node", () => {
  it("returns APPROVE when there are no issues", () => {
    expect(decide_verdict(baseState([])).verdict).toBe("APPROVE");
  });

  it("returns COMMENT when there are issues but none critical", () => {
    expect(decide_verdict(baseState([issue("warning"), issue("info")])).verdict).toBe("COMMENT");
  });

  it("returns REQUEST_CHANGES when any issue is critical", () => {
    expect(decide_verdict(baseState([issue("info"), issue("critical")])).verdict).toBe("REQUEST_CHANGES");
  });
});
