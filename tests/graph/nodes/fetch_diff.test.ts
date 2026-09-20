import { describe, expect, it, vi } from "vitest";
import { makeFetchDiffNode, DEFAULT_MAX_FILES } from "../../../src/graph/nodes/fetch_diff.js";
import type { GraphStateType } from "../../../src/graph/state.js";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index e69de29..b6fc4c6 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-  return 1;
+  return 2;
`;

function fileDiff(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..1234567",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1,1 @@",
    `+export const x = "${path}";`,
    "",
  ].join("\n");
}

function multiFileDiff(count: number): string {
  return Array.from({ length: count }, (_, i) => fileDiff(`src/file${i}.ts`)).join("");
}

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

  it("defaults maxFiles to 30", () => {
    expect(DEFAULT_MAX_FILES).toBe(30);
  });

  it("keeps every file and reports no skips when file count is at or under maxFiles", async () => {
    const getPrDiff = vi.fn().mockResolvedValue(multiFileDiff(3));
    const node = makeFetchDiffNode({ getPrDiff, githubToken: "fake-token", maxFiles: 3 });

    const result = await node(baseState());

    expect(result.files).toHaveLength(3);
    expect(result.fileErrors).toEqual([]);
  });

  it("keeps the first maxFiles files and marks the rest as skipped with a reason in fileErrors", async () => {
    const getPrDiff = vi.fn().mockResolvedValue(multiFileDiff(5));
    const node = makeFetchDiffNode({ getPrDiff, githubToken: "fake-token", maxFiles: 3 });

    const result = await node(baseState());

    expect(result.files?.map((f) => f.path)).toEqual(["src/file0.ts", "src/file1.ts", "src/file2.ts"]);
    expect(result.fileErrors).toEqual([
      { path: "src/file3.ts", stage: "skipped", message: expect.stringContaining("max_files") },
      { path: "src/file4.ts", stage: "skipped", message: expect.stringContaining("max_files") },
    ]);
  });
});
