import { unanalyzedPaths } from "../coverage.js";
import type { GraphStateType } from "../state.js";

export function format_no_issues(state: GraphStateType): Partial<GraphStateType> {
  const lines = [`## Code Review — verdict: ${state.verdict}`, "", summaryLine(state)];

  if (state.fileErrors.length > 0) {
    lines.push("", "### Notes");
    for (const error of state.fileErrors) {
      lines.push(`- Could not analyze ${error.path} (${error.stage}): ${error.message}`);
    }
  }

  return { reviewText: lines.join("\n") };
}

function summaryLine(state: GraphStateType): string {
  const unanalyzed = unanalyzedPaths(state.fileErrors);
  if (unanalyzed.size === 0) {
    return `No issues found across ${state.files.length} file(s) reviewed.`;
  }

  // Skipped files aren't in state.files (fetch_diff drops them), so the
  // total is the union of both.
  const total = new Set([...state.files.map((file) => file.path), ...unanalyzed]).size;
  const analyzed = total - unanalyzed.size;
  return (
    `**Review incomplete:** only ${analyzed} of ${total} changed file(s) were analyzed, ` +
    `and no issues were found in those. ${unanalyzed.size} file(s) could not be analyzed (see Notes) — ` +
    "this is not an approval."
  );
}
