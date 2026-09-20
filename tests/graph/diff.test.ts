import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, truncatePatch, truncateRelatedContext } from "../../src/graph/diff.js";

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index e69de29..b6fc4c6 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 function foo() {
-  return 1;
+  return 2;
+  // added comment
 }
diff --git a/src/bar.ts b/src/bar.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,3 @@
+export function bar() {
+  return 42;
+}
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export function deleted() {}
-
`;

describe("parseUnifiedDiff", () => {
  it("splits the diff into one entry per changed file", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);

    expect(files.map((f) => f.path)).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("excludes deleted files (no new-file content to analyze)", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);

    expect(files.find((f) => f.path === "src/deleted.ts")).toBeUndefined();
  });

  it("computes 1-indexed changed line numbers in the new file, added lines only", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);

    const foo = files.find((f) => f.path === "src/foo.ts");
    expect(foo?.changedLines).toEqual([2, 3]);

    const bar = files.find((f) => f.path === "src/bar.ts");
    expect(bar?.changedLines).toEqual([1, 2, 3]);
  });

  it("returns an empty array for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("keeps each file's hunk text in patch, starting at the first @@ line", () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);

    const foo = files.find((f) => f.path === "src/foo.ts");
    expect(foo?.patch.startsWith("@@ -1,3 +1,4 @@")).toBe(true);
    expect(foo?.patch).toContain("+  return 2;");
  });

  it("handles a pure rename with no content change (no hunks) without crashing", () => {
    const renameOnlyDiff = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 100%
rename from src/old-name.ts
rename to src/new-name.ts
`;

    const files = parseUnifiedDiff(renameOnlyDiff);

    expect(files).toEqual([{ path: "src/new-name.ts", patch: "", changedLines: [] }]);
  });
});

describe("truncatePatch", () => {
  it("returns the patch unchanged when at or under the line limit", () => {
    const patch = Array.from({ length: 500 }, (_, i) => `+line ${i}`).join("\n");

    expect(truncatePatch(patch, 500)).toBe(patch);
  });

  it("truncates a patch over the line limit and notes how many lines were omitted", () => {
    const patch = Array.from({ length: 600 }, (_, i) => `+line ${i}`).join("\n");

    const result = truncatePatch(patch, 500);

    expect(result.split("\n")).toHaveLength(501);
    expect(result).toContain("+line 499");
    expect(result).not.toContain("+line 500");
    expect(result).toContain("truncated at 500 lines, 100 more line(s) omitted");
  });
});

describe("truncateRelatedContext", () => {
  it("returns the text unchanged when at or under the char limit", () => {
    const text = "a".repeat(8000);

    expect(truncateRelatedContext(text, 8000)).toBe(text);
  });

  it("truncates text over the char limit and notes how many characters were omitted", () => {
    const text = "a".repeat(9000);

    const result = truncateRelatedContext(text, 8000);

    expect(result.startsWith("a".repeat(8000))).toBe(true);
    expect(result).toContain("truncated at 8000 characters, 1000 more character(s) omitted");
  });
});
