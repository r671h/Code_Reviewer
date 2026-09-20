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

  it("caps an oversized aggregated relatedContext before sending it to the LLM, so a file with many changed symbols can't blow up the prompt", async () => {
    const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
    const node = makeAnalyzeNode({ analyzeFile });

    // Simulates fetch_context concatenating get_related_context output for
    // dozens of changed symbols in one large file — each call is
    // individually budgeted, but nothing capped the sum until now.
    const hugeRelatedContext = Array.from(
      { length: 60 },
      (_, i) =>
        `Related context for \`fn${i}\`:\n- \`function fn${i}(x: number): number\` (from src/lib.ts)\n  /** Computes something involving fn${i} and its neighbors in the pipeline. */`,
    ).join("\n\n");
    const state = baseState({
      fileContexts: [{ path: "src/huge.ts", patch: "+x", relatedContext: hugeRelatedContext }],
    });

    await node(state);

    const sentContext = analyzeFile.mock.calls[0]?.[0]?.relatedContext as string;
    expect(sentContext.length).toBeLessThan(hugeRelatedContext.length);
    expect(sentContext).toContain("truncated");
  });

  describe("secret detection", () => {
    const AWS_KEY_PATCH = '+  accessKeyId: "AKIAIOSFODNN7EXAMPLE",';

    it("redacts a detected secret in the patch before it ever reaches the LLM", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [{ path: "src/config.ts", patch: AWS_KEY_PATCH, relatedContext: "" }],
      });

      await node(state);

      const sentPatch = analyzeFile.mock.calls[0]?.[0]?.patch as string;
      expect(sentPatch).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(sentPatch).toContain("[REDACTED]");
    });

    it("redacts a detected secret in relatedContext before it ever reaches the LLM", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [
          {
            path: "src/config.ts",
            patch: "+x",
            relatedContext: 'Related context for `configure`:\n- default value accessKeyId: "AKIAIOSFODNN7EXAMPLE"',
          },
        ],
      });

      await node(state);

      const sentContext = analyzeFile.mock.calls[0]?.[0]?.relatedContext as string;
      expect(sentContext).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(sentContext).toContain("[REDACTED]");
    });

    it("still sends the (redacted) file to the LLM, so the rest of the diff still gets reviewed", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [{ path: "src/config.ts", patch: AWS_KEY_PATCH, relatedContext: "" }],
      });

      await node(state);

      expect(analyzeFile).toHaveBeenCalledTimes(1);
    });

    it("adds a deterministic critical security issue, independent of what the LLM returns", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [{ path: "src/config.ts", patch: AWS_KEY_PATCH, relatedContext: "" }],
      });

      const result = await node(state);

      expect(result.issues).toEqual([
        expect.objectContaining({ file: "src/config.ts", severity: "critical", category: "security" }),
      ]);
    });

    it("never includes the raw secret value in the issue's explanation text", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [{ path: "src/config.ts", patch: AWS_KEY_PATCH, relatedContext: "" }],
      });

      const result = await node(state);

      expect(result.issues?.[0]?.explanation).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });

    it("keeps the LLM's own issues alongside the deterministic secret issue", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({
        issues: [{ file: "wrong.ts", line: 5, severity: "warning", category: "style", explanation: "nit" }],
      });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [{ path: "src/config.ts", patch: AWS_KEY_PATCH, relatedContext: "" }],
      });

      const result = await node(state);

      expect(result.issues).toHaveLength(2);
      expect(result.issues?.some((i) => i.category === "security")).toBe(true);
      expect(result.issues?.some((i) => i.category === "style")).toBe(true);
    });

    it("adds no secret issue when no pattern is found in patch or relatedContext", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [{ path: "src/clean.ts", patch: "+export const x = 1;", relatedContext: "" }],
      });

      const result = await node(state);

      expect(result.issues).toEqual([]);
    });
  });
});
