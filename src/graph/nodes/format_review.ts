import type { GraphStateType } from "../state.js";
import type { Issue } from "../../schemas/review.js";

export function format_review(state: GraphStateType): Partial<GraphStateType> {
  const lines: string[] = [`## Code Review — verdict: ${state.verdict}`, ""];
  lines.push(`Found ${state.issues.length} issue(s) across ${groupByFile(state.issues).size} file(s).`, "");

  for (const [file, issues] of groupByFile(state.issues)) {
    lines.push(`### ${file}`);
    for (const issue of sortBySeverity(issues)) {
      lines.push(`- **[${issue.severity}] ${issue.category}** (line ${issue.line}): ${issue.explanation}`);
    }
    lines.push("");
  }

  if (state.fileErrors.length > 0) {
    lines.push("### Notes");
    for (const error of state.fileErrors) {
      lines.push(`- Could not analyze ${error.path} (${error.stage}): ${error.message}`);
    }
    lines.push("");
  }

  return { reviewText: lines.join("\n").trimEnd() };
}

function groupByFile(issues: Issue[]): Map<string, Issue[]> {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const existing = groups.get(issue.file);
    if (existing) {
      existing.push(issue);
    } else {
      groups.set(issue.file, [issue]);
    }
  }
  return groups;
}

const SEVERITY_RANK: Record<Issue["severity"], number> = { critical: 0, warning: 1, info: 2 };

function sortBySeverity(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
