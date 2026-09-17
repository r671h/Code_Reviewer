import type { GraphStateType } from "../state.js";

export function format_no_issues(state: GraphStateType): Partial<GraphStateType> {
  const lines = [
    `## Code Review — verdict: ${state.verdict}`,
    "",
    `No issues found across ${state.files.length} file(s) reviewed.`,
  ];

  if (state.fileErrors.length > 0) {
    lines.push("", "### Notes");
    for (const error of state.fileErrors) {
      lines.push(`- Could not analyze ${error.path} (${error.stage}): ${error.message}`);
    }
  }

  return { reviewText: lines.join("\n") };
}
