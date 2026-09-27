import { unanalyzedPaths } from "../coverage.js";
import type { GraphStateType, Verdict } from "../state.js";

export function decide_verdict(state: GraphStateType): Partial<GraphStateType> {
  return { verdict: computeVerdict(state) };
}

function computeVerdict(state: GraphStateType): Verdict {
  if (state.issues.some((issue) => issue.severity === "critical")) return "REQUEST_CHANGES";
  if (state.issues.length > 0) return "COMMENT";
  // No issues is only an approval if every changed file was actually
  // analyzed — a file that failed or was skipped hasn't been shown clean.
  if (unanalyzedPaths(state.fileErrors).size > 0) return "COMMENT";
  return "APPROVE";
}
