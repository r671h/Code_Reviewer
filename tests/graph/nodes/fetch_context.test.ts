import { describe, expect, it, vi } from "vitest";
import { makeFetchContextNode } from "../../../src/graph/nodes/fetch_context.js";
import type { GraphStateType } from "../../../src/graph/state.js";
import { GitHubNetworkError } from "../../../src/mcp-server/errors.js";

const TS_SOURCE = `function target(x: number): number {
  return x + 1;
}
`;

function baseState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    files: [],
    fileContexts: [],
    issues: [],
    fileErrors: [],
    verdict: undefined,
    reviewText: undefined,
    ...overrides,
  };
}

describe("fetch_context node", () => {
  it("fetches file content, finds the changed symbol, and includes its related context", async () => {
    const getFileContent = vi.fn().mockResolvedValue(TS_SOURCE);
    const getRelatedContext = vi.fn().mockResolvedValue("Related context for `target`:\n(no related imports or sibling calls found)");
    const node = makeFetchContextNode({ getFileContent, getRelatedContext, githubToken: "fake-token" });

    const state = baseState({
      files: [{ path: "src/target.ts", patch: "@@ -1,1 +1,1 @@\n+  return x + 1;", changedLines: [2] }],
    });

    const result = await node(state);

    expect(getFileContent).toHaveBeenCalledWith({ repo: "octocat/hello-world", path: "src/target.ts" }, "fake-token");
    expect(getRelatedContext).toHaveBeenCalledWith(
      { repo: "octocat/hello-world", path: "src/target.ts", symbol: "target" },
      "fake-token",
    );
    expect(result.fileContexts?.[0]?.relatedContext).toContain("Related context for `target`");
  });

  it("skips AST analysis for non-TS files, leaving relatedContext empty", async () => {
    const getFileContent = vi.fn();
    const getRelatedContext = vi.fn();
    const node = makeFetchContextNode({ getFileContent, getRelatedContext, githubToken: "fake-token" });

    const state = baseState({
      files: [{ path: "README.md", patch: "+hello", changedLines: [1] }],
    });

    const result = await node(state);

    expect(getFileContent).not.toHaveBeenCalled();
    expect(result.fileContexts).toEqual([{ path: "README.md", patch: "+hello", relatedContext: "" }]);
  });

  it("records a fileError and still returns a context entry when fetching the file fails", async () => {
    const getFileContent = vi.fn().mockRejectedValue(new GitHubNetworkError("boom"));
    const getRelatedContext = vi.fn();
    const node = makeFetchContextNode({ getFileContent, getRelatedContext, githubToken: "fake-token" });

    const state = baseState({
      files: [{ path: "src/target.ts", patch: "+x", changedLines: [1] }],
    });

    const result = await node(state);

    expect(result.fileErrors).toEqual([{ path: "src/target.ts", stage: "fetch_context", message: expect.any(String) }]);
    expect(result.fileContexts?.[0]).toMatchObject({ path: "src/target.ts", relatedContext: "" });
  });

  it("records a fileError for a symbol whose related-context call fails, without dropping other symbols", async () => {
    const twoFnSource = `function a(): void {}\n\nfunction b(): void {}\n`;
    const getFileContent = vi.fn().mockResolvedValue(twoFnSource);
    const getRelatedContext = vi
      .fn()
      .mockRejectedValueOnce(new GitHubNetworkError("boom"))
      .mockResolvedValueOnce("Related context for `b`:\n(no related imports or sibling calls found)");
    const node = makeFetchContextNode({ getFileContent, getRelatedContext, githubToken: "fake-token" });

    const state = baseState({
      files: [{ path: "src/two.ts", patch: "+x", changedLines: [1, 3] }],
    });

    const result = await node(state);

    expect(result.fileErrors).toHaveLength(1);
    expect(result.fileContexts?.[0]?.relatedContext).toContain("Related context for `b`");
  });

  it("leaves relatedContext empty when no top-level function contains a changed line", async () => {
    const getFileContent = vi.fn().mockResolvedValue("const x = 1;\n");
    const getRelatedContext = vi.fn();
    const node = makeFetchContextNode({ getFileContent, getRelatedContext, githubToken: "fake-token" });

    const state = baseState({
      files: [{ path: "src/const.ts", patch: "+const x = 1;", changedLines: [1] }],
    });

    const result = await node(state);

    expect(getRelatedContext).not.toHaveBeenCalled();
    expect(result.fileContexts?.[0]?.relatedContext).toBe("");
  });

  it("does nothing and calls no MCP tools when there are no changed files (empty diff)", async () => {
    const getFileContent = vi.fn();
    const getRelatedContext = vi.fn();
    const node = makeFetchContextNode({ getFileContent, getRelatedContext, githubToken: "fake-token" });

    const result = await node(baseState({ files: [] }));

    expect(getFileContent).not.toHaveBeenCalled();
    expect(getRelatedContext).not.toHaveBeenCalled();
    expect(result).toEqual({ fileContexts: [], fileErrors: [] });
  });

  it("still includes a config-only file (e.g. package.json) for analysis, just without AST context", async () => {
    const getFileContent = vi.fn();
    const getRelatedContext = vi.fn();
    const node = makeFetchContextNode({ getFileContent, getRelatedContext, githubToken: "fake-token" });

    const state = baseState({
      files: [{ path: "package.json", patch: '+  "version": "1.0.1",', changedLines: [3] }],
    });

    const result = await node(state);

    expect(result.fileContexts).toEqual([
      { path: "package.json", patch: '+  "version": "1.0.1",', relatedContext: "" },
    ]);
  });
});
