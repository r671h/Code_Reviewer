import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, truncatePatch, MAX_PATCH_LINES } from "../../src/graph/diff.js";
import { findChangedSymbols, analyzeSymbol } from "../../src/mcp-server/github/related-context-ast.js";
import { makeFetchContextNode } from "../../src/graph/nodes/fetch_context.js";
import { makeAnalyzeNode } from "../../src/graph/nodes/analyze.js";
import type { GraphStateType } from "../../src/graph/state.js";

const SMALL_FILE_COUNT = 11;
const BIG_FILE_FUNCTION_COUNT = 40;
const BIG_FILE_LINES_PER_FUNCTION = 20;

function smallFileDiff(index: number): string {
  return [
    `diff --git a/src/handlers/handler${index}.ts b/src/handlers/handler${index}.ts`,
    "new file mode 100644",
    "index 0000000..1234567",
    "--- /dev/null",
    `+++ b/src/handlers/handler${index}.ts`,
    `@@ -0,0 +1,3 @@`,
    `+export function handler${index}(x: number): number {`,
    `+  return x + ${index};`,
    `+}`,
    "",
  ].join("\n");
}

function bigFileBody(): string {
  const lines: string[] = [];
  for (let fn = 0; fn < BIG_FILE_FUNCTION_COUNT; fn += 1) {
    lines.push(`export function bigFn${fn}(x: number): number {`);
    for (let body = 0; body < BIG_FILE_LINES_PER_FUNCTION - 2; body += 1) {
      lines.push(`  x = x + ${fn} + ${body}; // step ${body}`);
    }
    lines.push("}");
  }
  return lines.join("\n");
}

function bigFileDiff(): { diff: string; lineCount: number } {
  const body = bigFileBody();
  const bodyLines = body.split("\n");
  const diff = [
    "diff --git a/src/big.ts b/src/big.ts",
    "new file mode 100644",
    "index 0000000..89abcdef",
    "--- /dev/null",
    "+++ b/src/big.ts",
    `@@ -0,0 +1,${bodyLines.length} @@`,
    ...bodyLines.map((line) => `+${line}`),
    "",
  ].join("\n");
  return { diff, lineCount: bodyLines.length };
}

function buildLargeSyntheticDiff(): { diffText: string; totalFiles: number; bigFileLineCount: number } {
  const small = Array.from({ length: SMALL_FILE_COUNT }, (_, i) => smallFileDiff(i)).join("");
  const { diff: big, lineCount: bigFileLineCount } = bigFileDiff();
  return {
    diffText: small + big,
    totalFiles: SMALL_FILE_COUNT + 1,
    bigFileLineCount,
  };
}

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

describe("parseUnifiedDiff + truncatePatch on a large synthetic PR (10+ files, one 800+ line file)", () => {
  const { diffText, totalFiles, bigFileLineCount } = buildLargeSyntheticDiff();

  it("has a big file with 800+ new lines in the fixture itself", () => {
    expect(bigFileLineCount).toBeGreaterThanOrEqual(800);
  });

  it("parses every file out of the diff — none lost", () => {
    const files = parseUnifiedDiff(diffText);

    expect(files).toHaveLength(totalFiles);
    expect(files.map((f) => f.path)).toContain("src/big.ts");
    for (let i = 0; i < SMALL_FILE_COUNT; i += 1) {
      expect(files.map((f) => f.path)).toContain(`src/handlers/handler${i}.ts`);
    }
  });

  it("captures every added line of the big file as a changed line", () => {
    const files = parseUnifiedDiff(diffText);
    const big = files.find((f) => f.path === "src/big.ts");

    expect(big?.changedLines).toHaveLength(bigFileLineCount);
  });

  it("truncates only the big file's patch, leaving small files' patches untouched", () => {
    const files = parseUnifiedDiff(diffText);

    for (const file of files) {
      const truncated = truncatePatch(file.patch);
      if (file.path === "src/big.ts") {
        expect(truncated.split("\n")).toHaveLength(MAX_PATCH_LINES + 1);
        expect(truncated).toContain(`truncated at ${MAX_PATCH_LINES} lines`);
      } else {
        expect(truncated).toBe(file.patch);
      }
    }
  });
});

describe("fetch_context + analyze node timing on a large synthetic PR (mocked I/O)", () => {
  it("processes 12 files (one 800+ line file) within a reasonable time, and reports time per file", async () => {
    const { diffText } = buildLargeSyntheticDiff();
    const files = parseUnifiedDiff(diffText);

    const fetchContextNode = makeFetchContextNode({
      getFileContent: async (input) => {
        const file = files.find((f) => f.path === input.path);
        if (!file) throw new Error(`unexpected path ${input.path}`);
        // Reconstruct the new-file source from the patch's added lines —
        // stands in for what get_file_content would fetch from GitHub.
        return file.patch
          .split("\n")
          .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
          .map((line) => line.slice(1))
          .join("\n");
      },
      getRelatedContext: async (input) => `Related context for \`${input.symbol}\`:\n(no related imports found)`,
      githubToken: "fake-token",
    });

    const analyzeNode = makeAnalyzeNode({
      analyzeFile: async () => ({ issues: [] }),
    });

    const t0 = performance.now();
    const contextResult = await fetchContextNode(baseState({ files }));
    const t1 = performance.now();
    const analyzeResult = await analyzeNode(baseState({ fileContexts: contextResult.fileContexts ?? [] }));
    const t2 = performance.now();

    const fetchContextMs = t1 - t0;
    const analyzeMs = t2 - t1;
    const fileCount = files.length;

    // eslint-disable-next-line no-console
    console.log(
      `[large-pr timing] fetch_context: ${fetchContextMs.toFixed(1)}ms total, ` +
        `${(fetchContextMs / fileCount).toFixed(2)}ms/file avg (${fileCount} files)`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[large-pr timing] analyze: ${analyzeMs.toFixed(1)}ms total, ` +
        `${(analyzeMs / fileCount).toFixed(2)}ms/file avg (${fileCount} files)`,
    );

    expect(contextResult.fileErrors).toEqual([]);
    expect(analyzeResult.fileErrors).toEqual([]);
    // Generous ceiling — this is mocked I/O, so wall time here is ~CPU cost
    // (AST parsing, string work), not network/LLM latency. A regression to
    // pathological (e.g. quadratic) behavior would blow well past this.
    expect(fetchContextMs).toBeLessThan(5000);
    expect(analyzeMs).toBeLessThan(2000);
  });
});

describe("real AST cost of per-symbol related-context lookups on an 800+ line file", () => {
  it("finds every changed function as a changed symbol", () => {
    const { lineCount } = bigFileDiff();
    const source = bigFileBody();
    const changedLines = Array.from({ length: lineCount }, (_, i) => i + 1);

    const symbols = findChangedSymbols(source, changedLines, "src/big.ts");

    expect(symbols).toHaveLength(BIG_FILE_FUNCTION_COUNT);
  });

  it("re-parses the whole file once per changed symbol — measures the real cost of that redundancy", () => {
    const source = bigFileBody();
    const changedLines = Array.from({ length: source.split("\n").length }, (_, i) => i + 1);
    const symbols = findChangedSymbols(source, changedLines, "src/big.ts");

    const t0 = performance.now();
    for (const symbol of symbols) {
      analyzeSymbol(source, symbol, "src/big.ts");
    }
    const elapsedMs = performance.now() - t0;

    // eslint-disable-next-line no-console
    console.log(
      `[AST timing] ${symbols.length} full re-parses of an ${source.split("\n").length}-line file: ` +
        `${elapsedMs.toFixed(1)}ms total, ${(elapsedMs / symbols.length).toFixed(2)}ms/symbol avg`,
    );

    // Documents current cost so a future change to this scaling pattern
    // (e.g. genuinely quadratic blowup) shows up as a regression here.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
