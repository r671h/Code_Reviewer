import { describe, expect, it } from "vitest";
import { decide_verdict } from "../../../src/graph/nodes/decide_verdict.js";
import type { FileError, GraphStateType } from "../../../src/graph/state.js";
import type { Issue } from "../../../src/schemas/review.js";

function baseState(issues: Issue[], fileErrors: FileError[] = []): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    headSha: undefined,
    files: [],
    fileContexts: [],
    issues,
    fileErrors,
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

  it("does not APPROVE when a file's analysis failed — an unreviewed file is not a clean one", () => {
    const failed: FileError = { path: "src/a.ts", stage: "analyze", message: "402 Payment Required" };

    expect(decide_verdict(baseState([], [failed])).verdict).toBe("COMMENT");
  });

  it("does not APPROVE when files were skipped over max_files", () => {
    const skipped: FileError = { path: "src/z.ts", stage: "skipped", message: "exceeding max_files" };

    expect(decide_verdict(baseState([], [skipped])).verdict).toBe("COMMENT");
  });

  it("still APPROVEs when only fetch_context failed — the file was analyzed on its diff alone", () => {
    const noContext: FileError = { path: "src/a.ts", stage: "fetch_context", message: "not found" };

    expect(decide_verdict(baseState([], [noContext])).verdict).toBe("APPROVE");
  });

  it("returns COMMENT when there are issues but none critical", () => {
    expect(decide_verdict(baseState([issue("warning"), issue("info")])).verdict).toBe("COMMENT");
  });

  it("returns REQUEST_CHANGES when any issue is critical", () => {
    expect(decide_verdict(baseState([issue("info"), issue("critical")])).verdict).toBe("REQUEST_CHANGES");
  });
});
