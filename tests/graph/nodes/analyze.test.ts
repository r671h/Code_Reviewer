import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYZE_CONCURRENCY, makeAnalyzeNode } from "../../../src/graph/nodes/analyze.js";
import type { GraphStateType } from "../../../src/graph/state.js";
import type { Issue } from "../../../src/schemas/review.js";
import { RetryExhaustedError } from "../../../src/graph/retry.js";

function baseState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    repo: "octocat/hello-world",
    prNumber: 42,
    headSha: undefined,
    files: [],
    fileContexts: [],
    issues: [],
    fileErrors: [],
    verdict: undefined,
    reviewText: undefined,
    ...overrides,
  };
}

/** A realistic patch: parseUnifiedDiff always starts a file's patch at its first hunk header. */
const TEN_LINE_HUNK = "@@ -1,1 +1,10 @@\n+x";

describe("analyze node", () => {
  describe("concurrency", () => {
    function contexts(count: number) {
      return Array.from({ length: count }, (_, i) => ({ path: `src/f${i}.ts`, patch: TEN_LINE_HUNK, relatedContext: "" }));
    }

    it("analyzes up to `concurrency` files at once instead of one by one", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const analyzeFile = vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { issues: [] };
      });
      const node = makeAnalyzeNode({ analyzeFile, concurrency: 3 });

      await node(baseState({ fileContexts: contexts(7) }));

      expect(analyzeFile).toHaveBeenCalledTimes(7);
      expect(maxInFlight).toBe(3);
    });

    it("keeps issues and fileErrors in file order, whatever order the calls finish in", async () => {
      const analyzeFile = vi.fn(async ({ path }: { path: string }) => {
        const index = Number(/f(\d+)/.exec(path)?.[1]);
        await new Promise((r) => setTimeout(r, (5 - index) * 3));
        if (index === 1 || index === 3) throw new Error(`fail ${index}`);
        return {
          issues: [{ file: path, line: 1, severity: "info" as const, category: "style" as const, explanation: path }],
        };
      });
      const node = makeAnalyzeNode({ analyzeFile, concurrency: 5 });

      const result = await node(baseState({ fileContexts: contexts(5) }));

      expect(result.issues?.map((i) => i.file)).toEqual(["src/f0.ts", "src/f2.ts", "src/f4.ts"]);
      expect(result.fileErrors?.map((e) => e.path)).toEqual(["src/f1.ts", "src/f3.ts"]);
    });

    it("defaults to a small bounded concurrency", () => {
      expect(DEFAULT_ANALYZE_CONCURRENCY).toBeGreaterThan(1);
      expect(DEFAULT_ANALYZE_CONCURRENCY).toBeLessThanOrEqual(8);
    });
  });

  describe("dropping issues outside the diff", () => {
    const PATCH = ["@@ -1,2 +1,3 @@", " a", "+b", " c", "@@ -40,1 +41,2 @@", " d", "+e"].join("\n");
    const llmIssue = (line: number) => ({
      file: "src/a.ts",
      line,
      severity: "warning" as const,
      category: "bug" as const,
      explanation: `line ${line}`,
    });

    it("keeps model issues whose line falls inside a hunk of the diff", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [llmIssue(2), llmIssue(42)] });
      const node = makeAnalyzeNode({ analyzeFile });

      const result = await node(baseState({ fileContexts: [{ path: "src/a.ts", patch: PATCH, relatedContext: "" }] }));

      expect(result.issues?.map((i) => i.line)).toEqual([2, 42]);
    });

    it("drops model issues pointing at lines the diff doesn't touch (hallucinated or out of scope)", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [llmIssue(2), llmIssue(20), llmIssue(500)] });
      const node = makeAnalyzeNode({ analyzeFile });

      const result = await node(baseState({ fileContexts: [{ path: "src/a.ts", patch: PATCH, relatedContext: "" }] }));

      expect(result.issues?.map((i) => i.line)).toEqual([2]);
    });

    it("checks against the full patch, so an issue past the 500-line truncation point isn't dropped", async () => {
      const bigHunk = ["@@ -1,0 +1,600 @@", ...Array.from({ length: 600 }, (_, i) => `+line ${i}`)].join("\n");
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [llmIssue(550)] });
      const node = makeAnalyzeNode({ analyzeFile });

      const result = await node(baseState({ fileContexts: [{ path: "src/a.ts", patch: bigHunk, relatedContext: "" }] }));

      expect(result.issues?.map((i) => i.line)).toEqual([550]);
    });
  });

  it("calls analyzeFile for each file context and collects the issues", async () => {
    const analyzeFile = vi.fn().mockResolvedValue({
      issues: [{ file: "wrong.ts", line: 3, severity: "warning", category: "style", explanation: "nit" }],
    });
    const node = makeAnalyzeNode({ analyzeFile });

    const state = baseState({
      fileContexts: [{ path: "src/a.ts", patch: TEN_LINE_HUNK, relatedContext: "" }],
    });

    const result = await node(state);

    expect(analyzeFile).toHaveBeenCalledWith({ path: "src/a.ts", patch: TEN_LINE_HUNK, relatedContext: "" });
    expect(result.issues).toHaveLength(1);
  });

  it("overrides the issue's file field with the actual file path, not whatever the model returned", async () => {
    const analyzeFile = vi.fn().mockResolvedValue({
      issues: [{ file: "wrong.ts", line: 3, severity: "warning", category: "style", explanation: "nit" }],
    });
    const node = makeAnalyzeNode({ analyzeFile });

    const state = baseState({
      fileContexts: [{ path: "src/a.ts", patch: TEN_LINE_HUNK, relatedContext: "" }],
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
        { path: "src/good.ts", patch: TEN_LINE_HUNK, relatedContext: "" },
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
    // Built by concatenation so this file's own diff never contains a scanner match.
    const FAKE_AWS_KEY = "AKIA" + "Q3EGRV7XJ2MPLK4N";
    const AWS_KEY_PATCH = `@@ -1,1 +1,10 @@\n+  accessKeyId: "${FAKE_AWS_KEY}",`;

    function secretIssues(issues: Issue[] | undefined): Issue[] {
      return (issues ?? []).filter((issue) => issue.category === "security" && issue.severity === "critical");
    }

    it("points the secret issue at the added line's real new-file line number", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });
      const patch = ["@@ -10,3 +10,4 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", `+const key = "${FAKE_AWS_KEY}";`, " const c = 4;"].join(
        "\n",
      );

      const result = await node(baseState({ fileContexts: [{ path: "src/config.ts", patch, relatedContext: "" }] }));

      expect(secretIssues(result.issues).map((i) => i.line)).toEqual([12]);
    });

    it("raises no secret issue for a secret on an unchanged context line — this PR didn't add it — but still redacts it", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });
      const patch = ["@@ -1,2 +1,2 @@", ` const key = "${FAKE_AWS_KEY}";`, "-const x = 1;", "+const x = 2;"].join("\n");

      const result = await node(baseState({ fileContexts: [{ path: "src/config.ts", patch, relatedContext: "" }] }));

      expect(secretIssues(result.issues)).toEqual([]);
      expect(analyzeFile.mock.calls[0]?.[0]?.patch).not.toContain(FAKE_AWS_KEY);
    });

    it("raises no secret issue for a secret on a removed line", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });
      const patch = ["@@ -1,1 +1,1 @@", `-const key = "${FAKE_AWS_KEY}";`, "+const key = process.env.KEY;"].join("\n");

      const result = await node(baseState({ fileContexts: [{ path: "src/config.ts", patch, relatedContext: "" }] }));

      expect(secretIssues(result.issues)).toEqual([]);
    });

    it("raises no secret issue for AWS's documented example key", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });
      const patch = '@@ -1,0 +1,1 @@\n+const key = "AKIAIOSFODNN7EXAMPLE";';

      const result = await node(baseState({ fileContexts: [{ path: "tests/s3.test.ts", patch, relatedContext: "" }] }));

      expect(secretIssues(result.issues)).toEqual([]);
    });

    it("detects a secret added past the 500-line truncation point", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });
      const lines = Array.from({ length: 600 }, (_, i) => (i === 549 ? `+const key = "${FAKE_AWS_KEY}";` : `+line ${i}`));
      const patch = ["@@ -1,0 +1,600 @@", ...lines].join("\n");

      const result = await node(baseState({ fileContexts: [{ path: "src/big.ts", patch, relatedContext: "" }] }));

      expect(secretIssues(result.issues).map((i) => i.line)).toEqual([550]);
    });

    it("redacts a detected secret in the patch before it ever reaches the LLM", async () => {
      const analyzeFile = vi.fn().mockResolvedValue({ issues: [] });
      const node = makeAnalyzeNode({ analyzeFile });

      const state = baseState({
        fileContexts: [{ path: "src/config.ts", patch: AWS_KEY_PATCH, relatedContext: "" }],
      });

      await node(state);

      const sentPatch = analyzeFile.mock.calls[0]?.[0]?.patch as string;
      expect(sentPatch).not.toContain(FAKE_AWS_KEY);
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
            relatedContext: `Related context for configure:\n- default value accessKeyId: "${FAKE_AWS_KEY}"`,
          },
        ],
      });

      await node(state);

      const sentContext = analyzeFile.mock.calls[0]?.[0]?.relatedContext as string;
      expect(sentContext).not.toContain(FAKE_AWS_KEY);
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

      expect(result.issues?.[0]?.explanation).not.toContain(FAKE_AWS_KEY);
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
