import { describe, expect, it, vi } from "vitest";
import { makeFetchDiffNode } from "../../../src/graph/nodes/fetch_diff.js";
import type { GraphStateType } from "../../../src/graph/state.js";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index e69de29..b6fc4c6 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-  return 1;
+  return 2;
`;

function baseState(): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    files: [],
    fileContexts: [],
    issues: [],
    fileErrors: [],
    verdict: undefined,
    reviewText: undefined,
  };
}

describe("fetch_diff node", () => {
  it("calls get_pr_diff with the state's repo and PR number", async () => {
    const getPrDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF);
    const node = makeFetchDiffNode({ getPrDiff, githubToken: "fake-token" });

    await node(baseState());

    expect(getPrDiff).toHaveBeenCalledWith({ repo: "octocat/hello-world", pr_number: 42 }, "fake-token");
  });

  it("returns parsed files from the diff", async () => {
    const getPrDiff = vi.fn().mockResolvedValue(SAMPLE_DIFF);
    const node = makeFetchDiffNode({ getPrDiff, githubToken: "fake-token" });

    const result = await node(baseState());

    expect(result.files).toHaveLength(1);
    expect(result.files?.[0]).toMatchObject({ path: "src/foo.ts", changedLines: [1] });
    expect(result.files?.[0]?.patch).toContain("+  return 2;");
  });

  it("returns an empty files array for an empty diff (no changes), without crashing", async () => {
    const getPrDiff = vi.fn().mockResolvedValue("");
    const node = makeFetchDiffNode({ getPrDiff, githubToken: "fake-token" });

    const result = await node(baseState());

    expect(result.files).toEqual([]);
  });
});
