import { describe, expect, it } from "vitest";
import { buildReviewGraph } from "../../src/graph/graph.js";
import { GitHubNetworkError } from "../../src/mcp-server/errors.js";
import { RetryExhaustedError } from "../../src/graph/retry.js";
import { makePrintReviewNode } from "../../src/graph/nodes/print_review.js";

const SINGLE_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/a.ts
@@ -0,0 +1,1 @@
+export function a() { return 1; }
`;

describe("buildReviewGraph (end to end, mocked deps)", () => {
  it("keeps fileErrors from every stage — fetch_context's failure isn't wiped by analyze's own", async () => {
    const graph = buildReviewGraph({
      fetchDiff: { getPrDiff: async () => SINGLE_FILE_DIFF, githubToken: "t" },
      fetchContext: {
        getFileContent: async () => {
          throw new GitHubNetworkError("ctx boom");
        },
        getRelatedContext: async () => "",
        githubToken: "t",
      },
      analyze: {
        analyzeFile: async () => {
          throw new RetryExhaustedError(3, new Error("llm boom"));
        },
      },
      deliverReview: makePrintReviewNode({ print: () => {} }),
    });

    const result = await graph.invoke({ repo: "octocat/hello-world", prNumber: 1 });

    expect(result.fileErrors).toEqual([
      { path: "src/a.ts", stage: "fetch_context", message: expect.stringContaining("ctx boom") },
      { path: "src/a.ts", stage: "analyze", message: expect.stringContaining("llm boom") },
    ]);
  });
});
