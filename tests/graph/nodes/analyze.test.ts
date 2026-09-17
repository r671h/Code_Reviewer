import { describe, expect, it, vi } from "vitest";
import { makeAnalyzeNode } from "../../../src/graph/nodes/analyze.js";
import type { GraphStateType } from "../../../src/graph/state.js";
import { RetryExhaustedError } from "../../../src/graph/retry.js";

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

describe("analyze node", () => {
  it("calls analyzeFile for each file context and collects the issues", async () => {
    const analyzeFile = vi.fn().mockResolvedValue({
      issues: [{ file: "wrong.ts", line: 3, severity: "warning", category: "style", explanation: "nit" }],
    });
    const node = makeAnalyzeNode({ analyzeFile });

    const state = baseState({
      fileContexts: [{ path: "src/a.ts", patch: "+x", relatedContext: "" }],
    });

    const result = await node(state);

    expect(analyzeFile).toHaveBeenCalledWith({ path: "src/a.ts", patch: "+x", relatedContext: "" });
    expect(result.issues).toHaveLength(1);
  });

  it("overrides the issue's file field with the actual file path, not whatever the model returned", async () => {
    const analyzeFile = vi.fn().mockResolvedValue({
      issues: [{ file: "wrong.ts", line: 3, severity: "warning", category: "style", explanation: "nit" }],
    });
    const node = makeAnalyzeNode({ analyzeFile });

    const state = baseState({
      fileContexts: [{ path: "src/a.ts", patch: "+x", relatedContext: "" }],
    });

    const result = await node(state);

    expect(result.issues?.[0]?.file).toBe("src/a.ts");
  });

  it("returns no issues but no crash for a file with an empty issues array", async () => {
    const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
    const node = makeAnalyzeNode({ analyzeFile });

    const state = baseState({ fileContexts: [{ path: "src/a.ts", patch: "+x", relatedContext: "" }] });

    const result = await node(state);

    expect(result.issues).toEqual([]);
  });

  it("records a fileError and skips that file's issues when analysis is exhausted, without aborting the run", async () => {
    const analyzeFile = vi
      .fn()
      .mockRejectedValueOnce(new RetryExhaustedError(3, new Error("model unavailable")))
      .mockResolvedValueOnce({
        issues: [{ file: "wrong.ts", line: 1, severity: "info", category: "bug", explanation: "ok" }],
      });
    const node = makeAnalyzeNode({ analyzeFile });

    const state = baseState({
      fileContexts: [
        { path: "src/bad.ts", patch: "+x", relatedContext: "" },
        { path: "src/good.ts", patch: "+y", relatedContext: "" },
      ],
    });

    const result = await node(state);

    expect(result.fileErrors).toEqual([{ path: "src/bad.ts", stage: "analyze", message: expect.any(String) }]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.file).toBe("src/good.ts");
  });

  it("does not call analyzeFile when there are no file contexts (empty diff / no changes)", async () => {
    const analyzeFile = vi.fn();
    const node = makeAnalyzeNode({ analyzeFile });

    const result = await node(baseState({ fileContexts: [] }));

    expect(analyzeFile).not.toHaveBeenCalled();
    expect(result).toEqual({ issues: [], fileErrors: [] });
  });

  it("truncates an oversized patch before sending it to the LLM, so one huge file can't blow up the call", async () => {
    const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
    const node = makeAnalyzeNode({ analyzeFile });

    const hugePatch = Array.from({ length: 600 }, (_, i) => `+line ${i}`).join("\n");
    const state = baseState({
      fileContexts: [{ path: "src/huge.ts", patch: hugePatch, relatedContext: "" }],
    });

    await node(state);

    const sentPatch = analyzeFile.mock.calls[0]?.[0]?.patch as string;
    expect(sentPatch.split("\n").length).toBeLessThanOrEqual(501);
    expect(sentPatch).toContain("truncated at 500 lines");
  });
});
